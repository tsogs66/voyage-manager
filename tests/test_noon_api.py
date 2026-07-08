import tempfile
import unittest
from pathlib import Path

import app as app_module


class NoonApiTests(unittest.TestCase):
    def setUp(self):
        self.tmp_dir = tempfile.TemporaryDirectory()
        app_module.DB_PATH = Path(self.tmp_dir.name) / "test_voyage.db"
        app_module.init_db()
        app_module.app.config["TESTING"] = True
        self.client = app_module.app.test_client()

    def tearDown(self):
        self.tmp_dir.cleanup()

    def test_meta_entries_and_receipts_roundtrip(self):
        setup_payload = {
            "key": "setup",
            "value": {"vesselName": "M/V Test", "voyageNumber": "V-001"},
        }
        resp = self.client.put("/api/noon/meta/setup", json=setup_payload)
        self.assertEqual(resp.status_code, 200)

        entry_payload = {"id": "entry-1", "datetime": "2026-07-08T12:00", "rpm": 82}
        resp = self.client.put("/api/noon/entries/entry-1", json=entry_payload)
        self.assertEqual(resp.status_code, 200)

        receipt_payload = {"id": "receipt-1", "category": "fuel", "type": "HFO", "qty": 25.5}
        resp = self.client.put("/api/noon/receipts/receipt-1", json=receipt_payload)
        self.assertEqual(resp.status_code, 200)

        meta = self.client.get("/api/noon/meta").get_json()
        entries = self.client.get("/api/noon/entries").get_json()
        receipts = self.client.get("/api/noon/receipts").get_json()

        self.assertEqual(len(meta), 1)
        self.assertEqual(meta[0]["key"], "setup")
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0]["id"], "entry-1")
        self.assertEqual(len(receipts), 1)
        self.assertEqual(receipts[0]["id"], "receipt-1")

    def test_clear_store(self):
        self.client.put("/api/noon/entries/entry-1", json={"id": "entry-1"})
        self.client.put("/api/noon/entries/entry-2", json={"id": "entry-2"})

        clear_resp = self.client.delete("/api/noon/entries")
        self.assertEqual(clear_resp.status_code, 200)

        entries = self.client.get("/api/noon/entries").get_json()
        self.assertEqual(entries, [])


if __name__ == "__main__":
    unittest.main()
