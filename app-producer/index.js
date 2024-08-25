import express from 'express';
import dotenv from 'dotenv';
import { Kafka } from 'kafkajs';
import cron from 'node-cron';
import fetch from 'node-fetch';

dotenv.config();

const API_KEY = process.env.API_KEY;

const cities = [
 { name: 'New York', lat: 40.7128, lon: -74.006 }, // North America
 { name: 'São Paulo', lat: -23.5505, lon: -46.6333 }, // South America
 { name: 'London', lat: 51.5074, lon: -0.1278 }, // Europe
 { name: 'Cairo', lat: 30.0444, lon: 31.2357 }, // Africa
 { name: 'Sydney', lat: -33.8688, lon: 151.2093 }, // Australia
 { name: 'Tokyo', lat: 35.6895, lon: 139.6917 }, // Asia
 { name: 'Moscow', lat: 55.7558, lon: 37.6173 }, // Europe
 { name: 'Mumbai', lat: 19.076, lon: 72.8777 }, // Asia
 { name: 'Buenos Aires', lat: -34.6037, lon: -58.3816 }, // South America
 { name: 'Cape Town', lat: -33.9249, lon: 18.4241 }, // Africa
];

const app = express();
app.use(express.json());

const kafka = new Kafka({
 clientId: 'weather-producer',
 brokers: ['kafka:29092'],
});

const producer = kafka.producer();

// Add health check route
app.get('/health', (req, res) => {
 res.status(200).json({ status: 'OK', message: 'Producer service is healthy' });
});

async function fetchWeatherData(lat, lon) {
 const currentTime = Math.floor(Date.now() / 1000);
 try {
  const response = await fetch(
   `https://api.openweathermap.org/data/3.0/onecall/timemachine?lat=${lat}&lon=${lon}&dt=${currentTime}&units=metric&appid=${API_KEY}`
  );
  if (!response.ok) {
   throw new Error(`HTTP error! status: ${response.status}`);
  }
  return await response.json();
 } catch (error) {
  console.error('Error fetching weather data:', error);
  return null;
 }
}

function processWeatherData(data, city) {
 if (!data || !data.data || data.data.length === 0) {
  console.error('Invalid weather data received');
  return [];
 }

 const current = data.data[0];
 // Convert Unix timestamps to microseconds
 const toDBTime = (unixTimestamp) => {
  const toISO = new Date(unixTimestamp * 1000);
  const dateObj = new Date(toISO)
  const toMicroseconds = BigInt(dateObj.getTime()) * 1000n;
  console.log(toMicroseconds);

  return toMicroseconds;
 };

 return {
  city: city.name,
  timezone: data.timezone,
  timestamp: toDBTime(current.dt),
  temperature: current.temp,
  sunrise: toDBTime(current.sunrise),
  sunset: toDBTime(current.sunset),
  feels_like: current.feels_like,
  pressure: current.pressure,
  humidity: current.humidity,
  clouds: current.clouds,
  weather_main: current.weather[0].main,
  weather_description: current.weather[0].description,
  weather_icon: current.weather[0].icon,
 };
}

async function sendToKafka(data) {
 try {
  await producer.connect();
  const messages = data.map((item) => ({
   value: JSON.stringify(item, (key, value) =>
    typeof value === 'bigint' ? value.toString() : value
   ),
  }));
  await producer.send({
   topic: 'weather-data',
   messages,
  });
 } catch (error) {
  console.error('Error sending data to Kafka:', error);
 } finally {
  // await producer.disconnect();
 }
}

async function generateWeatherData() {
 const weatherDataPromises = cities.map((city) =>
  fetchWeatherData(city.lat, city.lon)
 );
 const weatherDataResults = await Promise.all(weatherDataPromises);

 const processedData = weatherDataResults
  .map((data, index) => processWeatherData(data, cities[index]))
  .filter((data) => data !== null);

 if (processedData.length > 0) {
  await sendToKafka(processedData);
 }
 return processedData;
}

// Initial run
generateWeatherData().then((data) => {
 if (data) {
  console.log('Initial weather data sent to Kafka:', data);
 }
});

// Schedule the task to run every 15 minutes
cron.schedule('*/15 * * * *', async () => {
 const weatherData = await generateWeatherData();
 if (weatherData) {
  console.log('Weather data sent to Kafka:', weatherData);
 }
});

app.listen(process.env.PORTA, () => {
 console.log('Weather Producer running on port', process.env.PORTA);
});
