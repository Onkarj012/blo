# Mobile Access Setup

## Access from Your Phone

### 1. Find Your Computer's IP Address

On macOS:
```bash
ipconfig getifaddr en0
```

Or look in System Preferences > Network

### 2. Start Next.js on All Interfaces

Run the dev server with:
```bash
npm run dev -- --hostname 0.0.0.0
```

Or add to your `package.json` scripts:
```json
{
  "scripts": {
    "dev:mobile": "next dev --hostname 0.0.0.0"
  }
}
```

Then run:
```bash
npm run dev:mobile
```

### 3. Access from Phone

Open your phone's browser and go to:
```
http://YOUR_COMPUTER_IP:3000
```

For example:
```
http://192.168.1.100:3000
```

### 4. Ensure Same WiFi

Both your computer and phone must be on the same WiFi network.

## CORS Configuration

All API routes now have CORS enabled with:
- Access-Control-Allow-Origin: *
- All HTTP methods allowed
- Credentials allowed

This allows requests from any origin (including your phone).

## Troubleshooting

### Can't Connect from Phone

1. **Check firewall:**
   ```bash
   sudo /usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate
   ```
   If enabled, you may need to allow Node.js through the firewall.

2. **Check IP address:**
   Make sure you're using the correct IP address from the same network interface.

3. **Test locally first:**
   - http://localhost:3000 should work on your computer
   - http://127.0.0.1:3000 should also work

4. **Try different port:**
   ```bash
   npm run dev -- --hostname 0.0.0.0 --port 3001
   ```

### Port Already in Use

Kill any existing Node.js processes:
```bash
killall node
```

Or find and kill specific process:
```bash
lsof -ti:3000 | xargs kill -9
```
