import React, { useEffect, useState } from "react";
import { Line } from "react-chartjs-2";
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Title,
    Tooltip,
    Legend,
    Filler
} from 'chart.js';

// ** FIREBASE IMPORTÁLÁSA **
import { db } from '../firebaseConfig'; 
import { doc, getDoc, setDoc } from "firebase/firestore";

// Regisztráljuk a szükséges Chart.js komponenseket
ChartJS.register(
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Title,
    Tooltip,
    Legend,
    Filler
);

// Kezdeti Valuták és Konstansok
const DEFAULT_BASE = "EUR";
const DEFAULT_TARGET = "RON";
// Valutakódok: Maradhat 24 óra, mert ritkán változik
const CODES_CACHE_LIFETIME_MS = 24 * 60 * 60 * 1000; 

// ÚJ KONSTANS: Aktuális árfolyam cache élettartama és frissítési intervallum (3 perc)
const CURRENT_RATE_CACHE_LIFETIME_MS = 3 * 60 * 1000; 


const ExchangeChart = ({ apiKey }) => {
    // 1. Állapotok
    const [base, setBase] = useState(DEFAULT_BASE);
    const [target, setTarget] = useState(DEFAULT_TARGET);
    
    const [chartData, setChartData] = useState(null);
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(true);
    
    const [currencyCodes, setCurrencyCodes] = useState([]);
    const [codesLoading, setCodesLoading] = useState(true);

    // ÚJ ÁLLAPOT: A frissítési ciklus vezérlésére
    const [refreshKey, setRefreshKey] = useState(0);

    // 3. --- 3 PERCES IDŐINTERVALLUM BEÁLLÍTÁSA (Polling) ---
    // Automatikusan kényszeríti a 2. useEffect újraindulását 3 percenként.
    useEffect(() => {
        const intervalId = setInterval(() => {
            // Növeljük a kulcsot, hogy a 2. useEffect újra lefusson
            setRefreshKey(prevKey => prevKey + 1);
            console.log(`--- Intervallum: Frissítés indítása (${new Date().toLocaleTimeString()}) ---`);
        }, CURRENT_RATE_CACHE_LIFETIME_MS);

        // Takarítás: Amikor a komponens eltűnik, töröljük az intervallumot
        return () => clearInterval(intervalId);
    }, []); 

    // 1. --- VALUTALISTA KEZELÉSE (exchangeData) ---
    // Betölti a valutakódokat a dropdownokhoz, cache-eli 24 órára.
    useEffect(() => {
        const fetchCodes = async () => {
            if (!apiKey) {
                setError("Hiányzik az API kulcs!");
                setCodesLoading(false);
                return;
            }
            
            try {
                setCodesLoading(true);
                const docRef = doc(db, "exchangeData", "supportedCodes");
                const docSnap = await getDoc(docRef);

                if (docSnap.exists() && (Date.now() - docSnap.data().timestamp < CODES_CACHE_LIFETIME_MS)) {
                    // Cache érvényes
                    console.log("Valutakódok betöltve a Firebase Cache-ből.");
                    setCurrencyCodes(docSnap.data().codes);
                } else {
                    // Cache lejárt/hiányzik, API hívás
                    console.log("Valutakódok lekérése API-ról...");
                    const url = `https://v6.exchangerate-api.com/v6/${apiKey}/codes`;
                    const res = await fetch(url);
                    
                    if (!res.ok) throw new Error(`API hiba a valutakódoknál: ${res.status}`);
                    
                    const data = await res.json();
                    
                    if (data.result !== "success" || !data.supported_codes) {
                        throw new Error("API hiba: Nem sikerült lekérni a valutalistát.");
                    }
                    
                    const codes = data.supported_codes.map(c => c[0]); // ['USD', 'EUR', ...]
                    setCurrencyCodes(codes);

                    // Mentés a Firebase-be
                    await setDoc(docRef, { 
                        codes: codes, 
                        timestamp: Date.now() 
                    });
                    console.log("Valutakódok elmentve a Firebase Cache-be.");
                }
            } catch (err) {
                console.error("Hiba a valutakódok kezelésénél:", err);
                setError(`Hiba a valutakódok betöltésekor: ${err.message}`);
            } finally {
                setCodesLoading(false);
            }
        };

        fetchCodes();
    }, [apiKey]);


    // 2. --- AKTUÁLIS ÁRFOLYAM LEKÉRÉSE ÉS CACHE-ELÉSE (exchangeRatesCache) ---
    // Dinamikusan kezeli az aktuális árfolyamot (egy pontot).
    useEffect(() => {
        const fetchCurrentDataAndCache = async () => {
            if (codesLoading || base === target || !apiKey || !base || !target) return;
            
            try {
                setLoading(true);
                setError(null);
                
                const cacheKey = `${base}_${target}`;
                const ratesCacheRef = doc(db, "exchangeRatesCache", cacheKey); // 3 perces cache
                const historyRef = doc(db, "exchangeHistory", cacheKey); // Történelmi napló
                let currentRate = null;
                let isApiCalled = false; // Jelzi, hogy volt-e API hívás

                // 1. **AKTUÁLIS ÁRFOLYAM ELLENŐRZÉS (3 perc)**
                const ratesDocSnap = await getDoc(ratesCacheRef);
                const CACHE_LIFETIME_MS = 3 * 60 * 1000; 
                const isCacheValid = ratesDocSnap.exists() && (Date.now() - ratesDocSnap.data().timestamp < CACHE_LIFETIME_MS); 
                
                if (isCacheValid) {
                    console.log(`Aktuális árfolyam betöltve a 3 perces Firebase Cache-ből: ${cacheKey}`);
                    currentRate = ratesDocSnap.data().rate;
                } else {
                    // Cache lejárt (3 perc eltelt) / hiányzik: API hívás
                    console.log("Aktuális árfolyam lekérése API-ról (latest)...");
                    
                    const url = `https://v6.exchangerate-api.com/v6/${apiKey}/latest/${base}`;
                    const response = await fetch(url);
                    if (!response.ok) throw new Error(`API hiba az aktuális árfolyamnál: ${response.status}`);
                    const data = await response.json();
                    
                    if (data.result !== "success" || !data.conversion_rates || !data.conversion_rates[target]) {
                        throw new Error("API hiba: Nem sikerült lekérni a célárfolyamot.");
                    }
                    
                    currentRate = data.conversion_rates[target];
                    isApiCalled = true;

                    // Mentés a 3 perces Aktuális Cache-be
                    await setDoc(ratesCacheRef, { 
                        rate: currentRate, 
                        base: base,
                        target: target,
                        timestamp: Date.now()
                    });
                    console.log("Aktuális árfolyam elmentve a 3 perces Firebase Cache-be.");
                }

                // 2. **TÖRTÉNELMI ADAT NAPLÓZÁSA (CSAK API HÍVÁS UTÁN)**
                if (isApiCalled && currentRate !== null) {
                    const historyDocSnap = await getDoc(historyRef);
                    let historicalData = [];

                    if (historyDocSnap.exists() && Array.isArray(historyDocSnap.data().data)) {
                        historicalData = historyDocSnap.data().data;
                    }

                    // Új adatpont, amit hozzáadunk a történelmi listához
                    const newEntry = { 
                        rate: currentRate, 
                        timestamp: Date.now() 
                    };
                    
                    // Ellenőrizzük, hogy az utolsó bejegyzés (ha van) nem ugyanaz-e, 
                    // így elkerülhetjük a fölösleges adatpontokat.
                    const lastEntry = historicalData[historicalData.length - 1];
                    if (!lastEntry || lastEntry.rate !== newEntry.rate) {
                        historicalData.push(newEntry);

                        // Korlátozzuk a tárolt adatpontok számát (pl. max. 100 pont)
                        if (historicalData.length > 100) {
                            historicalData.shift(); // A legrégebbi törlése
                        }
                        
                        // Mentés a Történelmi Gyűjteménybe
                        await setDoc(historyRef, { 
                            data: historicalData, 
                            base: base, 
                            target: target 
                        });
                        console.log("Új történelmi adatpont naplózva.");
                    } else {
                        console.log("Az árfolyam nem változott, nincs naplózás.");
                    }
                }
                
                // 3. **DIAGRAM ADATOK KIRAJZOLÁSA (Mindig történelmi adatokkal)**
                const finalHistoryDocSnap = await getDoc(historyRef);
                let finalHistoricalData = [];

                if (finalHistoryDocSnap.exists() && Array.isArray(finalHistoryDocSnap.data().data)) {
                    finalHistoricalData = finalHistoryDocSnap.data().data;
                }
                
                if (finalHistoricalData.length > 0) {
                    const labels = finalHistoricalData.map(item => {
                        const date = new Date(item.timestamp);
                        // Csak az óra és perc
                        return date.toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                    });
                    const rates = finalHistoricalData.map(item => item.rate);

                    setChartData({
                        labels,
                        datasets: [{
                            label: `${base} → ${target}`,
                            data: rates,
                            borderColor: "rgba(75,192,192,1)",
                            backgroundColor: "rgba(75,192,192,0.2)",
                            tension: 0.3, fill: true, pointRadius: 5, pointHoverRadius: 7,
                        }],
                    });
                } else if (currentRate !== null) {
                    // Ha nincs történelmi adat, de van aktuális, rajzoljunk ki egy pontot
                    const nowLabel = new Date().toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                     setChartData({
                        labels: [nowLabel],
                        datasets: [{
                            label: `${base} → ${target} (Aktuális)`,
                            data: [currentRate], 
                            borderColor: "rgba(75,192,192,1)",
                            backgroundColor: "rgba(75,192,192,0.5)",
                            tension: 0, fill: true, pointRadius: 8, pointHoverRadius: 10,
                        }],
                    });
                }
                
                setLoading(false);
            } catch (err) {
                console.error("Hiba az adatok kezelésénél:", err);
                setError(err.message);
                setLoading(false);
            }
        };

        fetchCurrentDataAndCache();
    // A refreshKey miatt 3 percenként újraindul a lekérdezés
    }, [base, target, apiKey, codesLoading, refreshKey]);
    
    // --- Swap Funkció ---
    const handleSwap = () => {
        setBase(target);
        setTarget(base);
    };

    // --- Megjelenítés (Loading/Error/JSX) ---

    // A betöltési állapotok kombinált kezelése
    if (codesLoading) {
        return (
            <div style={{ padding: "20px", textAlign: "center" }}>
                <p>Valutakódok betöltése...</p>
            </div>
        );
    }
    
    // Általános hiba
    if (error && !chartData) {
        return (
            <div style={{ padding: "20px", color: "red", textAlign: "center" }}>
                <p>Hiba: {error}</p>
                <small>Ellenőrizd az API kulcsot és a Firebase beállításokat (szabályokat!).</small>
            </div>
        );
    }
    
    // Betöltés, amíg az aktuális árfolyamra várunk
    if (loading && !chartData) {
        return (
             <div style={{ padding: "20px", textAlign: "center" }}>
                <p>Árfolyam adatok betöltése...</p>
            </div>
        );
    }

    return (
        <div style={{ padding: "20px" }}>
            
            {/* 🚀 Valuta választó dropdownok + Swap ikon */}
            <div style={{ 
                display: "flex", 
                alignItems: "center", 
                justifyContent: "center", 
                gap: "10px", 
                marginBottom: "20px",
                width: "100%", 
                maxWidth: "800px", 
                margin: "0 auto 20px auto" 
            }}>
                {/* Kiinduló Valuta */}
                <div>
                    <label htmlFor="base-currency">Kiinduló valuta:</label>
                    <select 
                        id="base-currency" 
                        value={base} 
                        onChange={(e) => setBase(e.target.value)}
                        style={{ marginLeft: "10px", padding: "5px" }}
                    >
                        {currencyCodes.map(code => (
                            <option key={`base-${code}`} value={code}>{code}</option>
                        ))}
                    </select>
                </div>
                
                {/* SWAP IKON */}
                <button 
                    onClick={handleSwap} 
                    title="Valuták cseréje"
                    style={{
                        padding: '5px 8px',
                        borderRadius: '50%', 
                        border: '1px solid #ccc',
                        cursor: 'pointer',
                        backgroundColor: '#f9f9f9',
                        fontSize: '16px',
                        lineHeight: '1',
                        height: '35px',
                        width: '35px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}
                >
                    &#8644; 
                </button>

                {/* Cél Valuta */}
                <div>
                    <label htmlFor="target-currency">Cél valuta:</label>
                    <select 
                        id="target-currency" 
                        value={target} 
                        onChange={(e) => setTarget(e.target.value)}
                        style={{ marginLeft: "10px", padding: "5px" }}
                    >
                        {currencyCodes.map(code => (
                            <option key={`target-${code}`} value={code}>{code}</option>
                        ))}
                    </select>
                </div>
            </div>

            {/* 📊 Diagram Konténer */}
            <div style={{ 
                width: "100%", 
                height: "400px", 
                margin: "0 auto", 
                maxWidth: "800px", 
                minHeight: '400px',
                textAlign: "center"
            }}>
                
                {error && (
                    <div style={{ color: 'red', marginTop: '10px' }}>
                        <p>Betöltési hiba: {error}</p>
                    </div>
                )}
                
                {chartData && (
                    <>
                        <Line
                            data={chartData}
                            options={{
                                responsive: true,
                                maintainAspectRatio: false,
                                plugins: {
                                    legend: { 
                                        display: true,
                                        position: 'top',
                                    },
                                    title: { 
                                        display: true, 
                                        text: `${base} → ${target} Aktuális árfolyam: ${chartData.datasets[0].data[0].toFixed(4)} ${target}`,
                                        font: { size: 16 }
                                    },
                                    tooltip: {
                                        callbacks: {
                                            // Megjeleníti az árfolyamot 4 tizedesjegy pontossággal
                                            label: function(context) {
                                                return `${context.parsed.y.toFixed(4)} ${target}`;
                                            }
                                        }
                                    }
                                },
                                scales: {
                                    y: {
                                        beginAtZero: false,
                                        ticks: {
                                            callback: function(value) {
                                                return value.toFixed(4) + ' ' + target;
                                            }
                                        }
                                    },
                                    x: {
                                        ticks: {
                                            maxRotation: 45,
                                            minRotation: 45
                                        }
                                    }
                                }
                            }}
                        />
                        <div style={{ textAlign: 'center', marginTop: '10px', fontSize: '12px', color: '#666' }}>
    Történelmi adatok az utolsó {chartData.labels.length} időpontról.
    <br/> 
    Utolsó adatpont: {chartData.labels[chartData.labels.length - 1]}
</div>
                    </>
                )}
            </div>
        </div>
    );
};

export default ExchangeChart;