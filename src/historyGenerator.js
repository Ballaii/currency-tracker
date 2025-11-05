// src/historyGenerator.js

import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc } from "firebase/firestore";

const firebaseConfig = {
  
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const HISTORICAL_DATA = [
    { 
        date: "2025-11-02", // 3 nappal ezelőtt (pl.)
        rate: 0.2008, 
        timestamp: new Date("2025-11-02").getTime() 
    },
    { 
        date: "2025-11-03", // 2 nappal ezelőtt
        rate: 0.1708, 
        timestamp: new Date("2025-11-03").getTime() 
    },
    { 
        date: "2025-11-04", // Tegnap
        rate: 0.2308, 
        timestamp: new Date("2025-11-04").getTime() 
    },
];

const BASE = "RON";
const TARGET = "EUR";

const generateHistory = async () => {
    const cacheRef = doc(db, "exchangeHistory", `${BASE}_${TARGET}`);
    
    const historicalDataForFirebase = {
        data: HISTORICAL_DATA, 
        date: new Date().toISOString().split('T')[0], 
        base: BASE,
        target: TARGET,
        timestamp: Date.now()
    };

    try {
        console.log(`Adatok generálása ${BASE}_${TARGET} párhoz...`);
        await setDoc(cacheRef, historicalDataForFirebase);
        console.log("✅ Történelmi adatok sikeresen beírva a Firebase-be az 'exchangeHistory' gyűjteménybe.");
    } catch (error) {
        console.error("❌ Hiba a Firebase írás során:", error);
    }
    
    process.exit(); 
};

generateHistory();