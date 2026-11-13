# Live sync over Wi-Fi or a phone hotspot (Voyage Chief)

Voyage Chief already syncs through its server: the PC runs it, and the phone and the PC's own app are both clients. Live sync adds what made that tedious, and a check that nothing did.

- **Find the server.** *Find server* asks each address on the usual router, Android-hotspot (192.168.43.x) and Windows-hotspot (192.168.137.x) ranges, or you type its address. Two PCs work the same way: one runs the server, the other is a client of it.
- **Pair once.** On the PC press *Show pairing code*; on the other device type it. The device is handed the server address and a credential — **the ship's own token**, so it can sync that vessel only — or the server's token if *share every vessel* was ticked. A code works once, for five minutes, and locks after five wrong tries. Only the PC's own screen can start one (not a caller arriving through the gateway).
- **Same ship only.** Each device tells the server which ship it has open (`POST /api/voyage-lan/presence`) and asks who else is there. The open leg is synced (`syncNow`, background, merging) only while another device is on the **same ship** (IMO, else name); otherwise the panel says who is on what.
- **Whole database.** Legs that exist on only one side, and ships this device lacks, are always listed with a *Copy* button. With *Whole database* chosen they are copied automatically once the device has been idle for a minute (`reconcileVoyageLegs`, the vessel library). Nothing is deleted.

Not done: Bluetooth (a hotspot is the same Wi-Fi); syncing with the app closed. Tests: `tests/test_lan_sync.py` (the server's pairing and presence), `tests/test_lan_sync.js` (what the app decides each round).
