import axios from 'axios';
import moment from 'moment';

export interface Alert {
    time: string;
    alert: string;
}

// Interfaces para tipagem
export interface CryptoData {
    times: string[];
    prices: number[];
    alerts: Alert[];
}

// Funções de detecção de padrões
function detectHeadAndShoulders(priceSeries: number[]): boolean {
    const n = priceSeries.length;
    if (n < 5) return false;

    // Identificar picos e vales locais
    const peaks: number[] = [];
    const troughs: number[] = [];

    for (let i = 1; i < n - 1; i++) {
        if (priceSeries[i] > priceSeries[i - 1] && priceSeries[i] > priceSeries[i + 1]) {
            peaks.push(i);
        }
        if (priceSeries[i] < priceSeries[i - 1] && priceSeries[i] < priceSeries[i + 1]) {
            troughs.push(i);
        }
    }

    if (peaks.length < 3 || troughs.length < 2) return false;

    // Considerar os 3 picos mais recentes
    const a = peaks[peaks.length - 3];
    const b = peaks[peaks.length - 2];
    const c = peaks[peaks.length - 1];

    const pa = priceSeries[a];
    const pb = priceSeries[b];
    const pc = priceSeries[c];

    // Verificar formato: pico do meio (cabeça) maior que ombros
    if (!(pb > pa && pb > pc)) return false;

    // Ombros com alturas semelhantes (tolerância de 15%)
    if (Math.abs(pa - pc) > 0.15 * pb) return false;

    // Encontrar vales entre os picos
    const troughsAB = troughs.filter(t => t > a && t < b);
    const troughsBC = troughs.filter(t => t > b && t < c);

    if (troughsAB.length === 0 || troughsBC.length === 0) return false;

    // Nível da linha de pescoço
    const neckVal = Math.min(
        Math.min(...troughsAB.map(t => priceSeries[t])),
        Math.min(...troughsBC.map(t => priceSeries[t]))
    );

    // Confirmar padrão se, após o último pico, o preço caiu abaixo da linha do pescoço
    return c < n - 1 && priceSeries[n - 1] < neckVal;
}

function detectTriangle(priceSeries: number[]): 'bullish' | 'bearish' | null {
    const n = priceSeries.length;
    if (n < 4) return null;

    const peaks: number[] = [];
    const troughs: number[] = [];

    for (let i = 1; i < n - 1; i++) {
        if (priceSeries[i] > priceSeries[i - 1] && priceSeries[i] > priceSeries[i + 1]) {
            peaks.push(i);
        }
        if (priceSeries[i] < priceSeries[i - 1] && priceSeries[i] < priceSeries[i + 1]) {
            troughs.push(i);
        }
    }

    if (peaks.length < 2 || troughs.length < 2) return null;

    const p1 = peaks[peaks.length - 2];
    const p2 = peaks[peaks.length - 1];
    const t1 = troughs[troughs.length - 2];
    const t2 = troughs[troughs.length - 1];

    const alt1 = p1 < t1 && t1 < p2 && p2 < t2;
    const alt2 = t1 < p1 && p1 < t2 && t2 < p2;

    if (!(alt1 || alt2)) return null;

    const p1Val = priceSeries[p1];
    const p2Val = priceSeries[p2];
    const t1Val = priceSeries[t1];
    const t2Val = priceSeries[t2];

    // Verificar convergência
    if (p2Val >= p1Val || t2Val <= t1Val) return null;

    // Evitar ruído: diferença mínima de 0.5%
    if (
        (p1Val - p2Val) / p1Val < 0.005 ||
        (t2Val - t1Val) / t1Val < 0.005
    ) return null;

    const current = priceSeries[n - 1];

    if (current > p2Val) return 'bullish';
    if (current < t2Val) return 'bearish';

    return null;
}

function detectFlag(priceSeries: number[]): 'bullish' | 'bearish' | null {
    const n = priceSeries.length;
    if (n < 6) return null;

    const start = priceSeries[0];
    const end = priceSeries[n - 1];

    let trend: 'bullish' | 'bearish' | null = null;

    if (end > start) trend = 'bullish';
    else if (end < start) trend = 'bearish';
    else return null;

    const firstSegment = Math.max(1, Math.floor(n / 3));

    if (trend === 'bullish') {
        const peakVal = Math.max(...priceSeries.slice(0, firstSegment + 1));
        const peakIdx = priceSeries.indexOf(peakVal);

        if (peakIdx >= n - 1) return null;

        const lowAfter = Math.min(...priceSeries.slice(peakIdx));
        const lowIdx = priceSeries.indexOf(lowAfter, peakIdx);

        const initialGain = peakVal - start;
        if (start === 0 || initialGain / start < 0.01) return null;

        const retrace = peakVal - lowAfter;
        if (retrace / initialGain > 0.8) return null;

        if (end > peakVal && lowIdx > peakIdx) return 'bullish';
    }
    else if (trend === 'bearish') {
        const troughVal = Math.min(...priceSeries.slice(0, firstSegment + 1));
        const troughIdx = priceSeries.indexOf(troughVal);

        if (troughIdx >= n - 1) return null;

        const highAfter = Math.max(...priceSeries.slice(troughIdx));
        const highIdx = priceSeries.indexOf(highAfter, troughIdx);

        const initialDrop = start - troughVal;
        if (start === 0 || initialDrop / start < 0.01) return null;

        const retrace = highAfter - troughVal;
        if (retrace / initialDrop > 0.8) return null;

        if (end < troughVal && highIdx > troughIdx) return 'bearish';
    }

    return null;
}

// Inicialização dos dados históricos
export class CryptoAnalysisService {
    private times: string[] = [];
    private prices: number[] = [];
    private maxPoints = 100;

    // Inicializar dados históricos
    async initializeHistoricalData(): Promise<void> {
        try {
            const end = moment();
            const start = moment().subtract(60, 'minutes');

            const response = await axios.get(
                'https://api.exchange.coinbase.com/products/BTC-USD/candles',
                {
                    params: {
                        granularity: 60,
                        start: start.toISOString(),
                        end: end.toISOString()
                    }
                }
            );

            if (response.status === 200) {
                const candles = response.data.reverse();

                this.times = candles.map((candle: number[]) =>
                    moment.unix(candle[0]).format('HH:mm:ss')
                );

                this.prices = candles.map((candle: number[]) => candle[4]);

                console.log(`Inicialização: carregados ${this.times.length} pontos de dados`);
            }
        } catch (error) {
            console.error('Erro na inicialização:', error);
        }
    }

    // Obter dados atualizados
    async getCurrentData(): Promise<CryptoData> {
        let currentPrice = this.prices.length > 0 ? this.prices[this.prices.length - 1] : 0;

        try {
            const response = await axios.get('https://api.exchange.coinbase.com/products/BTC-USD/ticker');

            if (response.status === 200) {
                currentPrice = parseFloat(response.data.price);
            }
        } catch (error) {
            console.error('Erro ao obter preço atual', error);
        }

        // Atualizar histórico
        const nowStr = moment().format('HH:mm:ss');
        this.times.push(nowStr);
        this.prices.push(currentPrice);

        // Limitar tamanho do histórico
        if (this.prices.length > this.maxPoints) {
            this.times = this.times.slice(-this.maxPoints);
            this.prices = this.prices.slice(-this.maxPoints);
        }

        // Verificar padrões
        const window = 100;
        const series = this.prices.slice(-window);
        const alerts: Alert[] = [];

        if (detectHeadAndShoulders(series)) {
            alerts.push({ time: nowStr, alert: "Padrão OCO confirmado (tendência de *baixa*)" });
        }

        const tri = detectTriangle(series);
        if (tri === 'bullish') {
            alerts.push( {time: nowStr, alert: "Rompimento de triângulo para *cima* (sinal de alta)"});
        } else if (tri === 'bearish') {
            alerts.push({time: nowStr, alert: "Rompimento de triângulo para *baixo* (sinal de baixa)"});
        }

        const flag = detectFlag(series);
        if (flag === 'bullish') {
            alerts.push({time: nowStr, alert: "Bandeira de *alta* confirmada (continuação bullish)"});
        } else if (flag === 'bearish') {
            alerts.push({time: nowStr, alert: "Bandeira de *baixa* confirmada (continuação bearish)"});
        }

        return {
            times: this.times,
            prices: this.prices,
            alerts
        };
    }
}