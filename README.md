# Royal Vegas — Multi-Hand Blackjack

A private, play-money casino built as a static web app. Deal up to 5 hands at once against the dealer, split, double down, and chase 21 — all with virtual chips only. No real money ever goes in or out; the "bankroll" is just a number you can top up any time from Settings.

Your balance, lifetime win/loss totals, hand history, and achievements are all saved locally in your browser (`localStorage`) so they persist between visits on the same device/browser.

## Features

- **Multi-hand blackjack** — play 1–5 hands per round, standard rules (blackjack pays 3:2, dealer stands on 17, double down, split once per hand, split aces get one card each).
- **Persistent bankroll** — add virtual funds any time from Settings; nothing here is real currency.
- **Lifetime stats** — total wagered, total won/lost, lifetime net, biggest win/loss, streaks, blackjacks hit, and more, tracked forever (until you reset).
- **Hand history** — a running log of every round you've played.
- **Achievements** — 19 badges to unlock as you play.
- **Settings** — number of decks (1/2/4/6/8), table felt color, sound effects, deal animation speed, and a full account reset.
- **Slots (coming soon)** — a placeholder tab is already wired up in the nav; your bankroll/stats/achievements will carry over automatically once the slot machine is added.
- **Realistic table look** — felt table, wood rail, hand-drawn suit pip layouts, face cards, and a card shoe indicator — pure CSS/SVG-style rendering, no external image assets, so it loads instantly.

## Project structure

```
casino-blackjack/
├── index.html          # all screens (lobby, table, history, achievements, settings, slots placeholder)
├── css/
│   └── styles.css      # all styling — felt table, cards, chips, panels, responsive layout
├── js/
│   ├── cards.js        # deck/shoe engine + card rendering (pips, faces, suits)
│   ├── blackjack.js    # game engine: betting, hit/stand/double/split, dealer logic, payouts
│   ├── storage.js       # localStorage persistence: balance, lifetime stats, history, settings
│   ├── achievements.js  # achievement definitions + unlock checks
│   ├── ui.js            # DOM wiring: nav, table rendering, history/achievements/settings screens
│   └── main.js           # app bootstrap
├── netlify.toml
├── .gitignore
└── README.md
```

No build step, no dependencies, no backend — it's plain HTML/CSS/JS that runs straight from static files.

## Run it locally

Just serve the folder with any static file server (opening `index.html` directly also works fine in most browsers):

```bash
cd casino-blackjack
python3 -m http.server 8080
# then open http://localhost:8080
```

## Deploy it yourself (GitHub + Netlify)

1. **Create a new GitHub repo** (e.g. `royal-vegas-blackjack`) on github.com — don't initialize it with a README since you already have one here.
2. **Push this folder to it:**
   ```bash
   cd casino-blackjack
   git init
   git add .
   git commit -m "Initial commit: Royal Vegas multi-hand blackjack"
   git branch -M main
   git remote add origin https://github.com/<your-username>/royal-vegas-blackjack.git
   git push -u origin main
   ```
3. **Connect it on Netlify:**
   - Go to [app.netlify.com](https://app.netlify.com) → **Add new site → Import an existing project**.
   - Pick GitHub, authorize if needed, and select your new repo.
   - Build settings: leave the build command blank (or `true`) and set the publish directory to `.` — this repo already ships a `netlify.toml` with those settings pre-filled, so Netlify should pick them up automatically.
   - Click **Deploy site**. You'll get a live `*.netlify.app` URL in under a minute.
4. **Optional — custom domain:** in the Netlify site's **Domain settings**, add a custom domain or change the auto-generated subdomain to something like `royal-vegas.netlify.app`.

From then on, every `git push` to `main` auto-deploys the latest version — same flow as your NFL card game project.

## Adding Slots later

The nav, routing, and a styled "coming soon" screen for Slots already exist (`#screen-slots` in `index.html`, `.navbtn[data-nav="slots"]`). When you're ready to build it:

- Add a `js/slots.js` engine (reels, paytable, spin logic) similar in shape to `blackjack.js`.
- Reuse `storage.js` — call `addFunds`, and extend `recordRound`/add a `recordSpin` helper so wins/losses feed the same lifetime stats and history.
- Reuse `achievements.js` — just add new achievement entries; the unlock/toast system already works for any stat you track.

## Notes

- This is intentionally play-money only: there's no payment integration, and it isn't meant to be one. The bankroll is just a locally-stored number that resets to $1,000 on a fresh browser and that you can top up freely from Settings.
- All game state lives in `localStorage` under the key `royalVegas.account.v1`. Clearing your browser's site data (or using a different browser/device) starts a fresh account. There's no server, so there's nothing to sync across devices unless you add one later.
