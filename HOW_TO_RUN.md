# How to run this and test it — in plain English

You don't need to understand the code. Just follow these steps in order.

## 1. One-time setup (do this once)

Open a terminal in this folder (`OpenWA`) and run:

```bash
npm install
```

This downloads the pieces the app needs. Takes a minute or two. You'll see a
lot of text scroll by — that's normal.

Now set your dashboard password. Copy the example settings file:

```bash
cp .env.example .env
```

Open the new `.env` file in any text editor (Notepad is fine) and change
this line to a password you'll remember:

```
DASHBOARD_PASSWORD=change-me
```

Save the file. Don't share this file with anyone or upload it anywhere —
it's your private password.

## 2. Start the app

Every time you want to use the dashboard, run:

```bash
npm start
```

You'll see a line like `Dashboard running at http://127.0.0.1:3000`. Leave
this terminal window open — closing it stops the app. If you close the
window and re-open it, just run `npm start` again to get going.

## 3. Open it in your browser

Go to this address in Chrome, Edge, or any browser:

```
http://127.0.0.1:3000
```

Type in the password you set in step 1, click **Log in**.

## 4. Connect your WhatsApp

You'll land on the **Dashboard** tab. Click the **Connect** tab. A QR code
will appear.

On your phone: open WhatsApp → tap the three dots (or Settings) → **Linked
Devices** → **Link a Device** → scan the QR code on your screen.

The little dot next to "WhatsApp connection" turns **green** once it's
connected. If it's **yellow**, it's still connecting — give it a few
seconds. If it's **red**, something's wrong — try the QR code again.

## 5. Upload your contacts

Click the **Contacts** tab. You need a CSV file — that's just a plain text
file with one phone number per line. You can make one in Excel or Google
Sheets: put phone numbers in the first column, then save/export as CSV.

Numbers should include the country code (e.g. `15551234567` for a US
number, or `919876543210` for an Indian number). If your numbers don't have
the country code, type it into the "Default country code" box before
uploading — the app will add it automatically.

Click **Choose File**, pick your CSV, click **Upload CSV**. You'll see how
many were accepted and how many were rejected (and why).

## 6. Write your messages

Click the **Message Variants** tab. Write a message, click **Add variant**.
Do this for each different version of your message (you can add as many as
you want, any time — before or during a campaign).

Each variant should read like a different message, not the same sentence
with one word swapped — that's the whole point of having variants.

## 7. Check your pacing settings (optional)

Click **Pacing/Settings** if you want to change how many messages go out
per batch, how long to wait for replies, or quiet hours (times it won't
send, like late at night). The defaults are sensible — you don't have to
touch this.

## 8. Start the campaign

Click the **Campaign** tab, click **Start**. That's it — the app will start
sending messages on its own, in the background, using the pacing settings
from step 7.

You can close the browser tab if you want — the sending keeps happening on
the computer as long as the `npm start` terminal window is still open.
Come back any time and click the tab again to check progress.

Use **Pause** / **Resume** / **Stop** the same way.

## 9. Watch it live

The **Dashboard** tab is your one-stop view: WhatsApp connection status,
campaign status, and contact counts, all with colored dots (green = good,
yellow = wait/attention, red = problem, gray = idle). It updates on its own
every few seconds — you don't need to refresh the page.

## 10. Get your report

On the **Dashboard** tab (or the **Contacts** tab), click **Download report
(CSV)**. This gives you a spreadsheet file with every contact, their status
(Pending / Replied / NoResponse / Invalid), and when they were messaged —
open it in Excel or Google Sheets.

## What the contact statuses mean

- **Pending** — hasn't been sent to yet.
- **Replied** — sent, and they replied. Success.
- **NoResponse** — sent, but they didn't reply within the batch's time window.
- **Invalid** — the number isn't on WhatsApp at all, so it was never sent to.

## If something looks wrong

- Check the **Logs** tab — it shows every send attempt and reply, newest
  first, with timestamps. Useful for figuring out what happened.
- If the campaign shows a yellow or red dot with a message at the top of
  the Campaign tab, read that message — it tells you why it paused
  (connection lost, too many failures in a row, or reply rate too low) and
  it will need you to click **Resume** once you've sorted it out.
- If you restart your computer or the `npm start` window closes by
  accident: just run `npm start` again. It picks up exactly where it left
  off — it won't re-send to anyone it already messaged.
