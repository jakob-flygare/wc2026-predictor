# WC2026 Friends Predictor

A static website for running a World Cup 2026 prediction league with friends. Hosted on GitHub Pages, powered by Google Sheets as a database.

---

## Architecture

```
Google Form  →  Google Sheets  →  index.html (GitHub Pages)
(friends)       (you update         (everyone views)
                 results here)
```

---

## Step 1 — Create the Google Sheet

Create a new Google Sheet with **two tabs**:

### Tab 1 — `Results` (you manage this)

Rename the first tab to `Results`. Set up these exact column headers in row 1:

| match_id | home_team | away_team | group | date | result |
|---|---|---|---|---|---|
| 1 | 🇺🇸 USA | 🇲🇽 Mexico | Group A | Jun 11 | home |
| 2 | 🇨🇦 Canada | 🏴󠁧󠁢󠁥󠁮󠁧󠁿 England | Group A | Jun 12 | |

- `result` values: `home` (home team wins), `away` (away team wins), `draw`, or **leave blank** for unplayed matches
- After each game, just fill in the result cell — the website updates on next reload

### Tab 2 — `Picks` (auto-filled by Google Form)

Rename the second tab to `Picks`. This gets populated automatically when friends submit the Form. Column structure (matches Form question order):

| Timestamp | Name | Match 1 | Match 2 | ... | Tournament Winner | Golden Boot |
|---|---|---|---|---|---|---|

---

## Step 2 — Create the Google Form

Create a new Google Form at forms.google.com. Link it to your Sheet (Responses → Link to Sheets → select your sheet, Picks tab).

### Form questions (in order):

1. **Your name** — Short answer, required
2. **Match 1: USA vs Mexico** — Multiple choice: `home` / `draw` / `away` *(or use the actual team names as labels, but store values as home/draw/away)*
3. **Match 2: Canada vs England** — Multiple choice: `home` / `draw` / `away`
4. *(repeat for all matches)*
5. **Tournament Winner** — Short answer (free text, e.g. "Brazil")
6. **Golden Boot** — Short answer (free text, e.g. "Mbappé")

> **Tip:** In Google Forms, set the "value" of each multiple choice option to exactly `home`, `draw`, or `away` (lowercase). This is what the website reads.

### Lock the form before the tournament starts

In Form settings → Responses → turn off "Accepting responses" on June 11 before kickoff.

---

## Step 3 — Publish the Sheet as CSV

1. In your Google Sheet: **File → Share → Publish to web**
2. In the first dropdown, select the **Results** tab
3. In the second dropdown, select **Comma-separated values (.csv)**
4. Click **Publish** and copy the URL — it looks like:
   ```
   https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/pub?gid=0&single=true&output=csv
   ```
5. Do the same for the **Picks** tab — you'll get a URL with `gid=1` (or a different number). The website auto-derives this from your Results URL by replacing the `gid`.

> Make sure the sheet is set to "Anyone with the link can **view**" — it does not need to be editable.

---

## Step 4 — Connect the website

1. Open `index.html` in a browser (or on GitHub Pages)
2. Go to the **⚙ Setup** tab
3. Paste your Results CSV URL
4. Click **Save & Reload Data**

The site will fetch live data every time the page is loaded.

---

## Step 5 — Deploy to GitHub Pages

1. Create a new **private** repository on your personal GitHub (e.g. `wc2026-predictor`)
2. Upload `index.html` to the repo
3. Go to **Settings → Pages**
4. Source: **Deploy from a branch** → `main` → `/root`
5. Save — your site will be live at `https://YOUR_USERNAME.github.io/wc2026-predictor/`
6. Share that URL with your friends

> GitHub Pages works with private repos if you have GitHub Pro/Team. If not, make the repo public (the site has no sensitive data).

---

## Day-to-day usage (during the tournament)

1. A game finishes
2. Open your Google Sheet → Results tab
3. Find the row for that match, type `home`, `away`, or `draw` in the result column
4. Done — the website updates for everyone on their next refresh

---

## Scoring (current rules — easy to change in the code)

- Correct match prediction: **+1 point**
- Tournament Winner correct: **+3 points** *(to be added in next iteration)*
- Golden Boot correct: **+2 points** *(to be added in next iteration)*

---

## File structure

```
wc2026-predictor/
└── index.html    ← the entire website, one file
└── README.md
```

That's it. One file, no build step, no dependencies to install.
