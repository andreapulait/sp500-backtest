# Range Backtest — S&P 500

Backtest statistico sul sottostante: dati una durata in giorni di borsa e due break-even,
l'app scorre la storia disponibile e misura dove sarebbe finito il prezzo rispetto a quei BEP.

Non è un backtest di opzioni. Non modella premio, greche, dividendi, slippage né assegnazione
anticipata: **dice dove è finito il prezzo, non quanto avresti guadagnato**. La strategia si
definisce altrove; qui se ne testa la geometria.

## Cosa misura

- frequenza di chiusura **dentro** i BEP, **oltre sopra**, **oltre sotto**
- frequenza di **tocco durante la vita** e di **tocco poi rientrato** — il caso che fa chiudere
  in perdita una posizione poi vincente
- **intensità** degli sfondamenti (media condizionata, mediana, p90, p99, massimo)
- **margine residuo** dal BEP più vicino nelle finestre chiuse dentro
- **escursione massima** favorevole e avversa durante la vita
- **curva di sfondamento**: per ogni distanza, la frequenza storica di superarla
- spaccati per **anno** e per **quintile di VIX** al giorno d'ingresso

## Gap di apertura

Seconda analisi, in `/gap`: distribuzione del gap fra la chiusura di una seduta e l'apertura della
successiva, raggruppata per classi di ampiezza, con **due archi temporali a confronto**.

**Lo strumento conta più del periodo.** L'apertura di un indice non è un prezzo scambiato: si
calcola dai primi scambi dei componenti, e quelli non ancora aperti contribuiscono con la chiusura
precedente. È una media fra prezzi nuovi e prezzi fermi, quindi comprime il gap per costruzione.

Su SPX di Yahoo l'effetto è massiccio e **varia nel tempo**, il che rende i confronti fra epoche
del tutto fuorvianti:

| SPX | sedute con open identico al close precedente | \|gap\| medio |
|---|---|---|
| 1990–1999 | 76,7% | 0,00% |
| 2000–2009 | 63,8% | 0,04% |
| 2010–2019 | 6,2% | 0,14% |
| 2020–oggi | ~0% | 0,39% |

Su SPY, che è realmente scambiato, i gap risultano circa il 30% più ampi a parità di periodo, pur
con correlazione 0,98 — non è una discrepanza, è la differenza fra riprezzamento reale e valore
stampato dall'indice. Per questo **SPY è lo strumento predefinito** e ogni periodo espone la quota
di aperture identiche come indicatore di qualità, con un avviso esplicito sopra il 2%.

## Fasi di massimi e minimi

Terza analisi, in `/swing`: la serie viene segmentata in fasi alternate. Una fase rialzista conta le
barre che formano un nuovo massimo (`high > high precedente`) e termina quando interviene una barra
che forma un nuovo minimo; da lì parte la fase ribassista, e così via. Le barre interne — che non
superano né il massimo né il minimo precedente — non contano e **non interrompono** la fase.

**La chiusura della fase è parametrica.** Due campi indicano quanti estremi contrari *consecutivi*
servono a chiuderla: minimi per il rialzo, massimi per il ribasso. Con 1 e 1 vale la regola stretta;
alzandoli le fasi sopravvivono ai ritracciamenti isolati e diventano swing di ampio respiro. Il
conteggio è consecutivo e non cumulativo — una soglia cumulativa chiuderebbe da sola qualunque
salita abbastanza lunga, accumulando giornate storte sparse.

Su SPX dal 2000 il parametro sposta tutto di un ordine di grandezza, e il residuo misurato dal
quarto massimo lo segue:

| soglia | fasi | lunghezza mediana | residuo dal 4° max | sedute |
|---|---|---|---|---|
| 1 | 1.417 | 2 | 0,15% | 1 |
| 2 | 538 | 4 | 0,71% | 3 |
| 3 | 248 | 8 | 2,04% | 9 |
| 4 | 99 | 19 | 4,34% | 28 |
| 5 | 47 | 30 | 7,77% | 59 |

Non esiste quindi una risposta unica a «quanto sale ancora»: la soglia va scelta in base
all'orizzonte della struttura che si sta costruendo. Ciò che resta stabile al variare della soglia è
la velocità dell'avanzamento, circa un terzo di punto percentuale per seduta.

Per ogni lunghezza di fase l'app riporta quante fasi la raggiungono, quante si fermano lì, e
soprattutto la **probabilità di prosecuzione**: dato che siamo alla quarta barra, quante volte ne è
arrivata una quinta. Su SPX dal 2000 emerge un'asimmetria netta — le fasi rialziste hanno lunghezza
mediana 2 e proseguono nel 55% dei casi, quelle ribassiste mediana 1 e proseguono nel 46%.

Un estrattore produce le **date ISO** in cui una fase raggiunge un conteggio scelto, con la
condizione opzionale che la fase opposta precedente ne abbia raggiunte almeno altrettante.

## Come vengono ancorati i BEP

I BEP si inseriscono in punti, in percentuale o in deviazioni standard sullo spot corrente: le tre
rappresentazioni sono sincronizzate. La forma canonica è la **distanza percentuale**, riapplicata
allo spot di ogni finestra storica.

Un secondo ancoraggio, **a sigma**, riscala invece i BEP con la volatilità di ciascun periodo —
l'ipotesi realistica per chi vende premio, dato che in regime volatile si incassa di più. Il
confronto tra i due è informativo: sull'S&P dal 2006, con BEP a ±1,20% su 5 giorni, l'ancoraggio
percentuale produce un tasso di permanenza che va dal 72,7% al 24,7% passando dal quintile di VIX
più basso al più alto; l'ancoraggio a sigma comprime quell'escursione a meno di 7 punti.

Un ancoraggio a punti fissi è deliberatamente assente: gli stessi punti valgono percentuali molto
diverse a livelli di indice diversi, quindi confronterebbe distanze non comparabili.

## Convenzioni di calcolo

- ingresso al **close** del giorno `t`, scadenza al close di `t+N`; il percorso per tocchi ed
  escursioni va da `t+1` a `t+N`, perché l'escursione intraday del giorno d'ingresso è già
  avvenuta quando si apre la posizione
- il conteggio in sigma usa il **rendimento logaritmico**, di cui sigma è la deviazione standard
- volatilità realizzata: deviazione standard campionaria dei rendimenti logaritmici a 30 giorni di
  borsa, annualizzata per `√252`, scalata sulla durata per `√(N/252)`
- il VIX **non** viene riportato in avanti sulle date mancanti, per non usare la volatilità di ieri
  proprio nei giorni turbolenti in cui il dato manca
- le finestre rolling giornaliere sono **sovrapposte**: l'app riporta sempre la stima di
  osservazioni indipendenti accanto al totale, e offre campionamento disgiunto o a giorno fisso

## Dati

Scaricati da Yahoo Finance e versionati in `src/data/` come file colonnari compatti (~2 MB).

| Simbolo | Serie | Da |
|---|---|---|
| SPX | `^GSPC` | 1927 |
| XSP | derivato `SPX / 10` | 1927 |
| SPY | `SPY` | 1993 |
| NDX | `^NDX` | 1985 |
| VIX | `^VIX` (regime, non sottostante) | 1990 |

XSP è derivato perché la serie nativa parte solo dal 2021. La definizione dell'indice è
esattamente un decimo di SPX, quindi la derivazione estende la storia senza approssimare.

Aggiornamento dei dati:

```bash
node scripts/fetch-data.mjs
```

Lo script valida monotonia delle date, coerenza OHLC e segnala buchi di calendario e salti
implausibili. Per aggiungere un sottostante basta inserirlo nell'array `SERIES`.

## Sviluppo

```bash
pnpm install
```

```bash
pnpm dev
```

```bash
pnpm test
```

Il motore sta in `src/lib/backtest/` come funzioni pure, coperto da test con casi calcolati a mano;
`scripts/smoke.mts` esegue una verifica end-to-end su dati reali.

## Stack

Next.js 16 (App Router), React 19, Tailwind 4, TypeScript, Vitest. Grafici in SVG scritti a mano,
senza librerie. Nessun database: le serie sono file nel repo, le strategie salvate stanno in
`localStorage` e i parametri sono condivisibili via query string.
