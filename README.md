ProofDrop Dashboard MVP (GitHub Pages)
=====================================

Files:
- index.html  : dashboard and wallet connect UI
- style.css   : styling
- app.js      : client-side logic (Web3Modal + Covalent + optional TheGraph/Moralis)
- config.json : editable API keys and scoring weights

Before publishing:
1. Open config.json and replace "YOUR_COVALENT_API_KEY" with your Covalent API key.
2. (Optional) Add The Graph endpoints for governance/airdrop subgraphs and Moralis API key.

Deploy to GitHub Pages:
1. Create a new GitHub repo and push these files to the main branch.
2. In the repo Settings → Pages, set source to main branch / root and save.
3. Visit the provided GitHub Pages URL after a minute.

Security note:
- This MVP calls Covalent directly from client-side JS; the API key will be visible in browser requests.
- For production, move API calls into a serverless function to keep keys secret.
