import React from "react";
import ExchangeChart from "./components/ExchangeChart";

function App() {
  return (
    <div style={{ padding: "2rem", fontFamily: "sans-serif" }}>
      <h1>💱 Currency Tracker</h1>
      <ExchangeChart 
      base="EUR" 
      target="RON" 
      apiKey={import.meta.env.VITE_EXCHANGE_API_KEY}
    />
    </div>
  );
}

export default App;
