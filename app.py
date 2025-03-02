
import os
import requests
from flask import Flask, jsonify, render_template

app = Flask(__name__)

# Listas globais para histórico de tempos e preços
times = []
prices = []

# Inicialização: obter últimos 60 minutos de preço BTC/USDT via API Binance (para gráfico inicial)
url_klines = "https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=60"
response = requests.get(url_klines)
if response.status_code == 200:
    data = response.json()
    for kline in data:
        # kline[0] = open time (timestamp em milissegundos), kline[4] = preço de fechamento
        ts = int(kline[0]) // 1000  # converter para segundos
        price = float(kline[4])
        # Formatar timestamp para HH:MM:SS
        import datetime
        time_str = datetime.datetime.fromtimestamp(ts).strftime("%H:%M:%S")
        times.append(time_str)
        prices.append(price)

# Funções de detecção de padrões:
def detect_head_and_shoulders(price_series):
    """Detecta padrão Ombro-Cabeça-Ombro (topo) e retorna True se confirmado."""
    n = len(price_series)
    if n < 5:
        return False
    # Identificar picos e vales locais
    peaks = []
    troughs = []
    for i in range(1, n-1):
        if price_series[i] > price_series[i-1] and price_series[i] > price_series[i+1]:
            peaks.append(i)
        if price_series[i] < price_series[i-1] and price_series[i] < price_series[i+1]:
            troughs.append(i)
    if len(peaks) < 3 or len(troughs) < 2:
        return False
    # Considerar os 3 picos mais recentes
    a, b, c = peaks[-3], peaks[-2], peaks[-1]
    # Garantir ordem temporal
    a, b, c = sorted([a, b, c])
    pa, pb, pc = price_series[a], price_series[b], price_series[c]
    # Verificar formato: pico do meio (cabeça) maior que ombros (picos a e c)
    if not (pb > pa and pb > pc):
        return False
    # Omomos (picos a e c) com alturas semelhantes (tolerância de 15%)
    if abs(pa - pc) > 0.15 * pb:
        return False
    # Encontrar vales (troughs) entre pico a->b e b->c (linha do pescoço)
    troughs_ab = [t for t in troughs if a < t < b]
    troughs_bc = [t for t in troughs if b < t < c]
    if not troughs_ab or not troughs_bc:
        return False
    # Nível da linha de pescoço (usar o menor vale entre os dois para confirmação)
    neck_val = min(min(price_series[t] for t in troughs_ab), min(price_series[t] for t in troughs_bc))
    # Confirmar padrão se, após o último pico (ombro direito), o preço atual caiu abaixo da linha do pescoço
    if c < n-1 and price_series[-1] < neck_val:
        return True
    return False

def detect_triangle(price_series):
    """Detecta padrão de triângulo simétrico e retorna 'bullish' (alto) ou 'bearish' (baixo) se rompido."""
    n = len(price_series)
    if n < 4:
        return None
    peaks = []
    troughs = []
    for i in range(1, n-1):
        if price_series[i] > price_series[i-1] and price_series[i] > price_series[i+1]:
            peaks.append(i)
        if price_series[i] < price_series[i-1] and price_series[i] < price_series[i+1]:
            troughs.append(i)
    if len(peaks) < 2 or len(troughs) < 2:
        return None
    # Últimos dois picos e dois vales
    p1, p2 = peaks[-2], peaks[-1]
    t1, t2 = troughs[-2], troughs[-1]
    # Verificar se alternam (pico-trough-pico-trough ou vice-versa)
    alt1 = p1 < t1 < p2 < t2
    alt2 = t1 < p1 < t2 < p2
    if not (alt1 or alt2):
        return None
    p1_val, p2_val = price_series[p1], price_series[p2]
    t1_val, t2_val = price_series[t1], price_series[t2]
    # Verificar convergência (picos descendentes e vales ascendentes)
    if p2_val >= p1_val or t2_val <= t1_val:
        return None
    # Evitar ruído: exigir diferença mínima de ~0.5%
    if (p1_val - p2_val) / p1_val < 0.005 or (t2_val - t1_val) / t1_val < 0.005:
        return None
    current = price_series[-1]
    if current > p2_val:
        return "bullish"   # rompim
    elif current < t2_val:
        return "bearish"   # rompimento para baixo
    else:
        return None

def detect_flag(price_series):
    """Detecta padrão de bandeira (flag) de continuação. Retorna 'bullish' ou 'bearish' se ocorrer rompimento."""
    n = len(price_series)
    if n < 6:
        return None
    start = price_series[0]
    end = price_series[-1]
    trend = None
    if end > start:
        trend = "bullish"
    elif end < start:
        trend = "bearish"
    else:
        return None
    first_segment = max(1, n // 3)  # usar aproximadamente primeiro terço como perna inicial
    if trend == "bullish":
        # Procurar pico inicial (flagpole up)
        peak_val = max(price_series[:first_segment+1])
        peak_idx = price_series.index(peak_val)
        if peak_idx >= n-1:
            return None
        # Menor preço após o pico (consolidação)
        low_after = min(price_series[peak_idx:])
        low_idx = price_series.index(low_after, peak_idx)
        # Cálculo dos movimentos
        initial_gain = peak_val - start
        if start == 0 or initial_gain / start < 0.01:
            return None  # subida inicial <1%
        retrace = peak_val - low_after
        if retrace / initial_gain > 0.8:
            return None  # retrocesso >80% (muito profundo, provavelmente não bandeira)
        # Rompimento: preço final acima do pico inicial
        if end > peak_val and low_idx > peak_idx:
            return "bullish"
    elif trend == "bearish":
        # Procurar vale inicial (flagpole down)
        trough_val = min(price_series[:first_segment+1])
        trough_idx = price_series.index(trough_val)
        if trough_idx >= n-1:
            return None
        # Maior preço após o vale (consolidação de alta)
        high_after = max(price_series[trough_idx:])
        high_idx = price_series.index(high_after, trough_idx)
        initial_drop = start - trough_val
        if start == 0 or initial_drop / start < 0.01:
            return None  # queda inicial pequena
        retrace = high_after - trough_val
        if retrace / initial_drop > 0.8:
            return None  # recuperou >80% da queda (não característico de bandeira)
        # Rompimento: preço final abaixo do vale inicial
        if end < trough_val and high_idx > trough_idx:
            return "bearish"
    return None
app.route("/")
def index():
    # Renderizar página HTML do painel
    return render_template("index.html")

@app.route("/data")
def get_data():
    """Endpoint que retorna dados de preço recentes e alertas de padrões."""
    global times, prices
    # Obter preço atual da Binance
    try:
        res = requests.get("https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT")
        current_price = float(res.json().get("price", 0.0))
    except Exception as e:
        current_price = prices[-1] if prices else 0.0  # em caso de erro, reutiliza último preço conhecido
    # Atualizar histórico
    from datetime import datetime
    now_str = datetime.now().strftime("%H:%M:%S")
    times.append(now_str)
    prices.append(current_price)
    # Manter tamanho do histórico limitado (p.ex. últimos ~300 pontos para não sobrecarregar)
    max_points = 300
    if len(prices) > max_points:
        times = times[-max_points:]
        prices = prices[-max_points:]
    # Verificar padrões no histórico recente (por exemplo, últimos 100 pontos)
    window = 100
    series = prices[-window:] if len(prices) >= window else prices
    alerts = []
    if detect_head_and_shoulders(series):
        alerts.append("Padrão OCO confirmado (tendência de *baixa*)")
    tri = detect_triangle(series)
    if tri == "bullish":
        alerts.append("Rompimento de triângulo para *cima* (sinal de alta)")
    elif tri == "bearish":
        alerts.append("Rompimento de triângulo para *baixo* (sinal de baixa)")
    flag = detect_flag(series)
    if flag == "bullish":
        alerts.append("Bandeira de *alta* confirmada (continuação bullish)")
    elif flag == "bearish":
        alerts.append("Bandeira de *baixa* confirmada (continuação bearish)")
    # Retornar JSON com times, prices e alerts
    return jsonify({
        "times": times,
        "prices": prices,
        "alerts": alerts
    })

# Executar aplicativo (apenas se rodar localmente; em produção usar gunicorn)
if __name__ == "_main_":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)