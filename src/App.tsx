import "./App.css";
import { CryptoAnalysis } from "./components/CryptoAnalysis";
import bitcoin from './assets/bitcoin.gif';

function App() {



  return (
    <main>
      <h2 className="text-center"><img src={bitcoin} style={{width: '50px', height: '50px'}} />Bitcoin BTC/USDT – Preço em Tempo Real</h2>
      <CryptoAnalysis></CryptoAnalysis>
    </main>
  );
}

export default App;
