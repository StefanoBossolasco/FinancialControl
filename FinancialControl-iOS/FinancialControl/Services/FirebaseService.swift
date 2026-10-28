import Foundation
import FirebaseAuth
import FirebaseFirestore

// MARK: - Auth Errors
enum AuthError: LocalizedError {
    case notAuthenticated
    case unknownError(String)

    var errorDescription: String? {
        switch self {
        case .notAuthenticated: return "Utente non autenticato"
        case .unknownError(let msg): return msg
        }
    }
}

// MARK: - FirebaseService
class FirebaseService: ObservableObject {

    static let shared = FirebaseService()
    private let db = Firestore.firestore()

    // MARK: - Auth

    var currentUser: User? { Auth.auth().currentUser }
    var isLoggedIn: Bool { currentUser != nil }

    func signIn(email: String, password: String) async throws {
        try await Auth.auth().signIn(withEmail: email, password: password)
    }

    func signUp(email: String, password: String) async throws {
        try await Auth.auth().createUser(withEmail: email, password: password)
    }

    func signOut() throws {
        try Auth.auth().signOut()
    }

    func sendPasswordReset(email: String) async throws {
        try await Auth.auth().sendPasswordReset(withEmail: email)
    }

    func changePassword(currentPw: String, newPw: String) async throws {
        guard let user = currentUser, let email = user.email else {
            throw AuthError.notAuthenticated
        }
        let credential = EmailAuthProvider.credential(withEmail: email, password: currentPw)
        try await user.reauthenticate(with: credential)
        try await user.updatePassword(to: newPw)
    }

    // MARK: - Firestore paths

    private func uid() throws -> String {
        guard let uid = currentUser?.uid else { throw AuthError.notAuthenticated }
        return uid
    }

    private func metaRef() throws -> DocumentReference {
        try db.document("users/\(uid())/meta/main")
    }

    private func txCollection() throws -> CollectionReference {
        try db.collection("users/\(uid())/transactions")
    }

    private func txDoc(_ id: String) throws -> DocumentReference {
        try db.document("users/\(uid())/transactions/\(id)")
    }

    private func budgetDoc(_ key: String) throws -> DocumentReference {
        try db.document("users/\(uid())/budgets/\(key)")
    }

    private func budgetCollection() throws -> CollectionReference {
        try db.collection("users/\(uid())/budgets")
    }

    private func walletCollection() throws -> CollectionReference {
        try db.collection("users/\(uid())/wallets")
    }

    private func walletDoc(_ id: String) throws -> DocumentReference {
        try db.document("users/\(uid())/wallets/\(id)")
    }

    // MARK: - Load

    func loadMeta() async throws -> [String: Any] {
        let snap = try await metaRef().getDocument()
        return snap.data() ?? [:]
    }

    func loadTransactions() async throws -> [[String: Any]] {
        let snap = try await txCollection().getDocuments()
        return snap.documents.map { doc in
            var d = doc.data()
            d["id"] = doc.documentID
            return d
        }
    }

    func loadBudgets() async throws -> [String: [String: Double]] {
        let snap = try await budgetCollection().getDocuments()
        var result: [String: [String: Double]] = [:]
        for doc in snap.documents {
            let budget = doc.data().compactMapValues { $0 as? Double }
            result[doc.documentID] = budget
        }
        return result
    }

    // MARK: - Save

    /// Merges into meta/main so fields this app doesn't manage (exchangeRates) are kept
    func saveMeta(settings: [String: Any], categories: [String]) async throws {
        try await metaRef().setData([
            "settings": settings,
            "categories": categories
        ], merge: true)
    }

    func saveTransaction(_ tx: [String: Any], id: String) async throws {
        try await txDoc(id).setData(tx)
    }

    /// Updates only the given fields; a nil value removes the field (e.g. walletId)
    func updateTransaction(id: String, fields: [String: Any?]) async throws {
        var data: [String: Any] = [:]
        for (k, v) in fields { data[k] = v ?? FieldValue.delete() }
        try await txDoc(id).updateData(data)
    }

    /// Appends exchange records to meta/main without touching the other fields
    func addExchangeRates(_ rates: [[String: Any]]) async throws {
        try await metaRef().setData(["exchangeRates": FieldValue.arrayUnion(rates)], merge: true)
    }

    // MARK: - Wallets

    func loadWallets() async throws -> [[String: Any]] {
        let snap = try await walletCollection().getDocuments()
        return snap.documents.map { doc in
            var d = doc.data()
            d["id"] = doc.documentID
            return d
        }
    }

    func saveWallet(_ data: [String: Any], id: String) async throws {
        try await walletDoc(id).setData(data)
    }

    /// Deletes the wallet and removes walletId from its transactions in the same batches
    func deleteWallet(id: String, assignedTxIds: [String]) async throws {
        let col = try txCollection()
        var batch = db.batch()
        var count = 0
        for txId in assignedTxIds {
            batch.updateData(["walletId": FieldValue.delete()], forDocument: col.document(txId))
            count += 1
            if count >= 499 {
                try await batch.commit()
                batch = db.batch()
                count = 0
            }
        }
        batch.deleteDocument(try walletDoc(id))
        try await batch.commit()
    }

    /// Assigns (walletId) or unassigns (nil) many transactions in batched writes
    func assignWallet(txIds: [String], walletId: String?) async throws {
        let col = try txCollection()
        var batch = db.batch()
        var count = 0
        for txId in txIds {
            batch.updateData(["walletId": walletId ?? FieldValue.delete()], forDocument: col.document(txId))
            count += 1
            if count >= 499 {
                try await batch.commit()
                batch = db.batch()
                count = 0
            }
        }
        if count > 0 { try await batch.commit() }
    }

    func listenToWallets(onChange: @escaping ([[String: Any]]) -> Void) throws -> ListenerRegistration {
        let col = try walletCollection()
        return col.addSnapshotListener { snap, err in
            guard let snap = snap, err == nil else { return }
            onChange(snap.documents.map { doc in
                var d = doc.data()
                d["id"] = doc.documentID
                return d
            })
        }
    }

    func deleteTransaction(id: String) async throws {
        try await txDoc(id).delete()
    }

    func saveBudget(key: String, budget: [String: Double]) async throws {
        let data = budget.mapValues { $0 as Any }
        try await budgetDoc(key).setData(data)
    }

    func deleteBudget(key: String) async throws {
        try await budgetDoc(key).delete()
    }

    // MARK: - Batch save transactions

    func saveTransactions(_ txs: [[String: Any]]) async throws {
        let col = try txCollection()
        var batch = db.batch()
        var count = 0
        for tx in txs {
            guard let id = tx["id"] as? String else { continue }
            var data = tx
            data.removeValue(forKey: "id")
            batch.setData(data, forDocument: col.document(id))
            count += 1
            if count >= 499 {
                try await batch.commit()
                batch = db.batch()
                count = 0
            }
        }
        if count > 0 { try await batch.commit() }
    }

    // MARK: - Clear

    func clearAllTransactions() async throws {
        let snap = try await txCollection().getDocuments()
        var batch = db.batch()
        var count = 0
        for doc in snap.documents {
            batch.deleteDocument(doc.reference)
            count += 1
            if count >= 499 {
                try await batch.commit()
                batch = db.batch()
                count = 0
            }
        }
        if count > 0 { try await batch.commit() }
    }

    func clearAllBudgets() async throws {
        let snap = try await budgetCollection().getDocuments()
        let batch = db.batch()
        snap.documents.forEach { batch.deleteDocument($0.reference) }
        try await batch.commit()
    }

    // MARK: - Real-time listener

    func listenToTransactions(onChange: @escaping ([[String: Any]]) -> Void) throws -> ListenerRegistration {
        let col = try txCollection()
        return col.addSnapshotListener { snap, err in
            guard let snap = snap, err == nil else { return }
            let txs: [[String: Any]] = snap.documents.map { doc in
                var d = doc.data()
                d["id"] = doc.documentID
                return d
            }
            onChange(txs)
        }
    }
}
