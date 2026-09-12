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

**If the connection drops later:** the Connect tab has two buttons.
**Reconnect** tries again with the same WhatsApp number — use this first,
it's the quick fix for a normal drop. **Connect a different number**
disconnects completely and shows a fresh QR code for pairing a *different*
number — only use this if you actually want to switch numbers, since it
starts the pairing over from scratch. Either way, nothing about your
contacts or campaign progress is affected — that's tracked completely
separately from the WhatsApp connection itself.

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

**Cleaning up your contact list.** Below the table there's a **Filter**
dropdown (show only Pending, only Replied, etc.) and checkboxes on each
row. Tick the ones you want gone (or tick the checkbox in the header to
select everyone currently shown), then click **Delete selected** — it'll
ask you to confirm the count before anything is removed. This permanently
deletes them, not just changes their status.

**Tracking who's been sent to.** The contacts table shows a "Sent At" and
"Replied At" time for each contact, so you can see exactly what happened
and when — this is tracked completely separately from the WhatsApp
connection, so it survives a disconnect/reconnect with no data lost. The
counts row also shows a **Sent** number: contacts already messaged but
still waiting on a reply (once they reply or the wait times out, they move
to Replied/NoResponse and drop out of that count).

## 6. Write your messages

Click the **Message Variants** tab. Write a message, click **Add variant**.
Do this for each different version of your message (you can add as many as
you want, any time — before or during a campaign).

Each variant should read like a different message, not the same sentence
with one word swapped — that's the whole point of having variants.

**About the channel link in your message.** Use the real, direct WhatsApp
channel link in every variant — not a shortened one. WhatsApp shows its
own warning screen when someone taps a shortened link (tinyurl and
similar), which makes the message look *more* suspicious, not less. The
direct link is WhatsApp's own domain, so it's trusted automatically and
shows a nice preview card in the chat. The wording of each variant is what
should differ, not the link.

**Counting as a reply.** If your message asks people to react with an
emoji (👍 or ❤️, like in the Ganesh festival example), that counts as a
reply just like a typed message does — the app watches for both.
Each run prints a different short link (e.g.
`https://tinyurl.com/22tacl9o`) that goes to the same real channel — paste
one into each variant. Takes a couple seconds, no setup needed.

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

## 11. Starting completely over with the same list

Once a campaign finishes (or any time you want a clean slate), go to the
**Campaign** tab and click **Reset campaign** (the red button). It will:

1. Automatically download a report first, so you keep a record of who
   replied last time.
2. Put every contact back to "Pending" — ready to be messaged again from
   scratch, with a blank slate.

Your pacing settings (batch size, delays, quiet hours, etc.) are kept —
only the contact statuses get wiped. Since this can't be undone (beyond
that downloaded report), it will ask you to type **RESET CAMPAIGN**
(exactly, in capitals) into a popup before anything happens — this is
deliberately more friction than a simple "are you sure?" click, so a
stray click can't wipe your campaign by accident.

If you just want to message a brand-new list of people instead, you don't
need Reset at all — just upload the new CSV (step 5) and click Start.

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
