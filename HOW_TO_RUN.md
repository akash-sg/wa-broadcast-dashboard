# How to run this and test it

You don't need to understand the code. Just follow these steps in order.

## 1. One-time setup (do this once)

Get the code onto your computer. If you haven't already, clone it from
GitHub (needs [git](https://git-scm.com/downloads) installed):

```bash
git clone https://github.com/akash-sg/wa-broadcast-dashboard.git
```

Open a terminal in that folder and run:

```bash
npm install
```

This downloads the pieces the app needs. Takes a minute or two. You'll see a
lot of text scroll by — that's normal.

**Every person running this needs their own password — it's not shared
through GitHub.** Copy the example settings file:

```bash
cp .env.example .env
```

Open the new `.env` file in any text editor (Notepad is fine) and change
this line to a password you'll remember:

```
DASHBOARD_PASSWORD=change-me
```

Save the file. Don't share this file with anyone or upload it anywhere —
it's your private password. (`.env` is deliberately left out of GitHub —
that's what keeps it private — so nothing here gets copied to anyone else
automatically, and if someone else clones the repo, they *must* set their
own password before the app will run at all.)

## 2. Start the app

Every time you want to use the dashboard, run:

```bash
npm start
```

You'll see a line like `Dashboard running at http://127.0.0.1:3000`. Leave
this terminal window open — closing it stops the app. If you close the
window and re-open it, just run `npm start` again to get going.

**If you cloned this from GitHub** (rather than a zip someone sent you),
you can pick up the latest updates first by running this instead:

```bash
npm run update
```

That pulls whatever's newest from GitHub, re-installs anything that
changed, and starts the app — one command instead of three. There's no
*automatic* background updating (the app doesn't check for updates on its
own while running) — you or your friend just run this instead of
`npm start` whenever you want to grab the latest version before that
session.

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

## 7. Check your pacing settings (optional, but worth it for a big list)

Click **Pacing/Settings** to change how many messages go out per batch,
how long to wait for replies, or quiet hours (times it won't send, like
late at night). The defaults are sensible for a small list, but they're
also *slow* — with 800+ contacts the default settings can take several
days, because the app waits up to 30 minutes after each small batch of 5
hoping for replies, and pauses for 11 hours a night.

Click **Fill in faster settings for a large list** to load quicker values
(bigger batches, no waiting around for replies before moving on), then
**Save settings**. You can still edit any field by hand afterwards —
nothing is applied until you click Save.

The one tradeoff to know: the delay between individual sends and the
quiet hours exist to make sending look human and avoid WhatsApp flagging
the number. Shrinking or disabling those sends faster but is riskier —
that's a judgment call for you to make, not something the app can decide
for you.

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
