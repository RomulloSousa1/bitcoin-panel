import React, { useState, useEffect } from 'react';
import { CryptoAnalysisService, CryptoData } from '../services/cryptoAnalysis';
import { Line } from 'react-chartjs-2';
import Chart, { LineController } from 'chart.js/auto';
import {
    isPermissionGranted,
    requestPermission,
    sendNotification,
} from '@tauri-apps/plugin-notification';


export const CryptoAnalysis: React.FC = () => {
    Chart.register(LineController);

    const [cryptoData, setCryptoData] = useState<CryptoData>({
        times: [],
        prices: [],
        alerts: []
    });
    const [isLoading, setIsLoading] = useState(true);

    async function checkAndSendNotification(title: string, body: string) {
        let permissionGranted = await isPermissionGranted();

        if (!permissionGranted) {
            const permission = await requestPermission();
            permissionGranted = permission === "granted";
        }

        sendNotification({ title, body });
    }

    useEffect(() => {
        const analysisService = new CryptoAnalysisService();

        const fetchData = async () => {
            try {
                // Inicializar dados históricos
                await analysisService.initializeHistoricalData();

                // Buscar dados atuais
                const data = await analysisService.getCurrentData();
                setCryptoData(data);
                setIsLoading(false);

                // Configurar atualização periódica
                const intervalId = setInterval(async () => {
                    const updatedData = await analysisService.getCurrentData();
                    setCryptoData(updatedData);
                    const latestPriceElement = document.getElementById("latestPrice");
                    latestPriceElement!.textContent = updatedData.prices[updatedData.prices.length - 1].toString();
                }, 10000);

                // Limpar intervalo ao desmontar
                return () => clearInterval(intervalId);
            } catch (error) {
                console.error('Erro ao buscar dados', error);
                setIsLoading(false);
            }
        };
        fetchData();
    }, []);

    useEffect(() => {
        console.log(cryptoData.alerts);
        if (cryptoData.alerts.length > 0) {
            let alert_div = document.querySelector(".alert");
            let alertNow = cryptoData.alerts[cryptoData.alerts.length - 1];
            if (alertNow.alert.toLowerCase().includes('alta')) {
                alert_div?.classList.add('alert', 'alert-success', 'text-center', 'fw-bold');
            } else if (alertNow.alert.toLowerCase().includes('baixa')) {
                alert_div?.classList.add('alert', 'alert-danger', 'text-center', 'fw-bold');
            } else {
                alert_div?.classList.add('alert', 'alert-warning', 'text-center', 'fw-bold');
            }
            checkAndSendNotification("Novo Alerta às " + alertNow.time, alertNow.alert);
        }

    }, [cryptoData.alerts.length]);

    if (isLoading) {
        return <div>Carregando dados...</div>;
    }

    return (
        <div>
            <p className="text-center">Último preço: <strong><span id="latestPrice">--</span> USDT</strong></p>
            <div id="chart-div">
                <Line data={{
                    labels: cryptoData.times,
                    datasets: [
                        {
                            label: 'Preço BTC/USDT',
                            data: cryptoData.prices,
                            borderColor: 'rgba(75, 192, 192, 1) ',
                            backgroundColor: 'rgba(75, 192, 192, 0.2)',
                            borderWidth: 2,
                            tension: 0.1
                        },
                    ],
                }}
                    options={{
                        plugins: {
                            colors: {
                                enabled: true,
                            },
                            legend: {
                                display: true,
                                labels: {
                                    color: 'white'
                                }
                            }
                        },
                        scales: {
                            x: {
                                display: true,
                                title: {
                                    display: true,
                                    text: 'Horário',
                                    color: 'white'
                                },
                                ticks: {
                                    color: 'white' // Adiciona cor aos labels do eixo X
                                }
                            },
                            y: {
                                display: true,
                                title: {
                                    display: true,
                                    text: 'Preço (USDT)',
                                    color: 'white'
                                },
                                ticks: {
                                    color: 'white' // Adiciona cor aos labels do eixo Y
                                }
                            }
                        }
                    }}
                >
                </Line>
            </div>
            <h3>Alertas</h3>
            {
                cryptoData.alerts.length > 0 ? (
                    <div id="alert_div">
                        {cryptoData.alerts.map((alert) => (
                            <div className="alert text-center fw-bold w-50">{alert.alert} - Ás {alert.time}</div>
                        ))}
                    </div>
                ) : (
                    <p>Sem Alertas no momento!</p>
                )
            }
        </div >
    );
};