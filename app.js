// ProofDrop MVP app.js - client-side wallet connect + scoring using Covalent + Web3Modal
(async function(){
  const $ = s => document.querySelector(s);

  // load config.json
  let config = {};
  try {
    const resp = await fetch('config.json');
    config = await resp.json();
  } catch(e){
    console.warn('Failed to load config.json', e);
  }

  // provider options for Web3Modal (WalletConnect included for mobile)
  const providerOptions = {
    walletconnect: {
      package: window.WalletConnectProvider.default,
      options: {
        infuraId: null
      }
    }
  };

  const web3Modal = new window.Web3Modal.default({
    cacheProvider: false,
    providerOptions
  });

  const connectBtn = $('#connectBtn');
  const walletCard = $('#walletCard');
  const walletAddrEl = $('#walletAddr');
  const chainEl = $('#connectedChain');
  const scoreVal = $('#scoreVal');
  const scoreBar = $('#scoreBar');
  const badgeEl = $('#badge');
  const breakdownEl = $('#breakdown');

  let provider, signer, address;

  connectBtn.addEventListener('click', async ()=>{
    try {
      provider = await web3Modal.connect();
      const ethersProvider = new ethers.providers.Web3Provider(provider);
      signer = ethersProvider.getSigner();
      address = await signer.getAddress();
      const network = await ethersProvider.getNetwork();
      walletAddrEl.textContent = address;
      chainEl.textContent = 'Network: ' + (network.name || network.chainId);
      walletCard.style.display = 'block';
      computeAndRender(address);
    } catch(e){
      console.error('connect error', e);
      alert('Connection failed: '+ (e.message || e));
    }
  });

  async function computeAndRender(addr){
    // reset UI
    scoreVal.textContent = '...';
    scoreBar.style.width = '0%';
    badgeEl.textContent = 'Calculating...';
    breakdownEl.innerHTML = '';

    // Covalent transactions_v3 endpoint
    const chainId = config.chain_id || 1;
    const covKey = config.covalent_api_key || 'YOUR_COVALENT_API_KEY';
    const txUrl = `https://api.covalenthq.com/v1/${chainId}/address/${addr}/transactions_v3/?page-size=100&key=${covKey}`;

    let txData = [];
    try {
      const r = await fetch(txUrl);
      const j = await r.json();
      txData = j?.data?.items || [];
    } catch(e){
      console.warn('Covalent fetch failed', e);
    }

    // compute metrics
    let firstTs = null;
    let totalGasWei = 0;
    const contracts = new Set();
    let airdropLike = 0;

    for(const t of txData){
      const ts = new Date(t.block_signed_at).getTime();
      if(!firstTs || ts < firstTs) firstTs = ts;
      const gasOffered = Number(t.gas_offered || 0);
      const gasPrice = Number(t.gas_price || 0);
      totalGasWei += (gasOffered * gasPrice);
      if(t.log_events){
        for(const ev of t.log_events){
          if(ev.sender_address) contracts.add(ev.sender_address.toLowerCase());
          if(ev.decoded && ev.decoded.name === 'Transfer' && ev.decoded.params){
            const params = ev.decoded.params;
            const toParam = params.find(p=>p.name==='to' || p.name==='dst' || p.name==='recipient');
            const valueParam = params.find(p=>p.name==='value' || p.name==='wad' || p.name==='amount');
            const toAddr = toParam?.value?.toLowerCase();
            if(toAddr === addr.toLowerCase()){
              airdropLike += 1;
            }
          }
        }
      }
    }

    const walletAgeMonths = firstTs ? Math.max(0, Math.floor((Date.now() - firstTs) / (1000*60*60*24*30))) : 0;
    const totalGasEth = totalGasWei / 1e18;
    const uniqueContracts = contracts.size;

    // The Graph queries (optional)
    let governanceVotes = 0;
    let airdropsClaimed = 0;
    try {
      if(config.thegraph_endpoints && config.thegraph_endpoints.governance){
        const q = { query: 'query($wallet:String!){ votes(where:{voter:$wallet}){id} }', variables:{ wallet: addr.toLowerCase() } };
        const resp = await fetch(config.thegraph_endpoints.governance, { method:'POST', body: JSON.stringify(q), headers:{ 'Content-Type':'application/json' }});
        const j = await resp.json();
        governanceVotes = (j?.data?.votes || []).length || 0;
      }
      if(config.thegraph_endpoints && config.thegraph_endpoints.airdrops){
        const q2 = { query: 'query($wallet:String!){ airdropClaims(where:{claimer:$wallet}){id} }', variables:{ wallet: addr.toLowerCase() } };
        const resp2 = await fetch(config.thegraph_endpoints.airdrops, { method:'POST', body: JSON.stringify(q2), headers:{ 'Content-Type':'application/json' }});
        const j2 = await resp2.json();
        airdropsClaimed = (j2?.data?.airdropClaims || []).length || 0;
      }
    } catch(e){
      console.warn('The Graph fetch failed', e);
    }

    // Moralis (optional) - estimate DeFi interactions
    let defiActions = 0;
    try {
      if(config.moralis_api_key){
        const morUrl = `https://deep-index.moralis.io/api/v2/${addr}/transactions?chain=eth`;
        const resp = await fetch(morUrl, { headers: { 'X-API-Key': config.moralis_api_key } });
        const jm = await resp.json();
        const txs = jm || [];
        defiActions = txs.filter(tx=>tx.to && tx.input && tx.input.length>2).length;
      }
    } catch(e){
      console.warn('Moralis fetch failed', e);
    }

    const metrics = {
      walletAgeMonths,
      totalGasEth,
      uniqueContracts,
      governanceVotes,
      defiActions,
      airdropsClaimed: airdropsClaimed + airdropLike
    };

    // scoring using config weights (each metric weight is absolute points out of 100)
    const weights = config.metrics || {};
    function metricScore(key, value){
      const m = weights[key];
      if(!m) return 0;
      const capKey = Object.keys(m).find(k=>k.startsWith('cap'));
      const cap = m[capKey] !== undefined ? m[capKey] : (m.cap || 1);
      const normalized = Math.min(1, value / cap);
      return normalized * m.weight;
    }

    const s_age = metricScore('walletAge', metrics.walletAgeMonths);
    const s_gas = metricScore('gasSpent', metrics.totalGasEth);
    const s_contracts = metricScore('uniqueContracts', metrics.uniqueContracts);
    const s_gov = metricScore('governanceVotes', metrics.governanceVotes);
    const s_defi = metricScore('defiActions', metrics.defiActions);
    const s_air = metricScore('airdropsClaimed', metrics.airdropsClaimed);

    let rawScore = s_age + s_gas + s_contracts + s_gov + s_defi + s_air;
    rawScore = Math.max(0, Math.min(100, Math.round(rawScore)));

    // pick badge
    let badgeName = 'Newbie';
    for(const [name,range] of Object.entries(config.badges || {})){
      if(rawScore >= range[0] && rawScore <= range[1]) { badgeName = name; break; }
    }

    // render
    $('#scoreVal').textContent = rawScore;
    $('#scoreBar').style.width = rawScore + '%';
    $('#badge').textContent = badgeName;
    $('#breakdown').innerHTML = `
      <strong>Breakdown</strong>
      <ul>
        <li>Wallet age (months): ${metrics.walletAgeMonths} — score ${Math.round(s_age)}</li>
        <li>Total gas (ETH): ${metrics.totalGasEth.toFixed(5)} — score ${Math.round(s_gas)}</li>
        <li>Unique contracts interacted: ${metrics.uniqueContracts} — score ${Math.round(s_contracts)}</li>
        <li>Governance votes: ${metrics.governanceVotes} — score ${Math.round(s_gov)}</li>
        <li>DeFi actions (approx): ${metrics.defiActions} — score ${Math.round(s_defi)}</li>
        <li>Airdrops claimed (approx): ${metrics.airdropsClaimed} — score ${Math.round(s_air)}</li>
      </ul>
    `;
  }

})();
