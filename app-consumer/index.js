import express from 'express';
import dotenv from 'dotenv';
import { Kafka } from 'kafkajs';
import { Sender } from '@questdb/nodejs-client';

dotenv.config();

const app = express();
app.use(express.json());

const kafka = new Kafka({
 clientId: 'weather-consumer',
 brokers: ['kafka:29092'],
});

const consumer = kafka.consumer({
 groupId: 'weather-group',
 retry: {
  retries: 8, // Increase the number of retries
 },
 requestTimeout: 60000, // Increase the request timeout
});

// Add health check route
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', message: 'Consumer service is healthy' });
});

async function saveToQuestDB(data) {
  const sender = Sender.fromConfig(
   'http::addr=questdb:9000;username=admin;password=quest;'
  );
 try {
  await sender
   .table('weather_data')
   .symbol('city', data.city)
   .symbol('timezone', data.timezone)
   .timestampColumn('timestamp', parseInt(data.timestamp))
   .floatColumn('temperature', data.temperature)
   .timestampColumn('sunrise', parseInt(data.sunrise))
   .timestampColumn('sunset', parseInt(data.sunset))
   .floatColumn('feels_like', data.feels_like)
   .floatColumn('pressure', data.pressure)
   .floatColumn('humidity', data.humidity)
   .stringColumn('weather_main', data.weather_main)
   .stringColumn('weather_desc', data.weather_description)
   .stringColumn('weather_icon', data.weather_icon)
   .at(Date.now(), 'ms');
  console.log('Data saved to QuestDB');
 } catch (error) {
  console.error('Error saving data to QuestDB:', error);
 } finally {
  await sender.flush();
  await sender.close();
 }
}

async function processMessage(message) {
 const data = JSON.parse(message.value.toString());
 console.log('Received weather data:', data);
 await saveToQuestDB(data);
}

async function startConsumer() {
 await consumer.connect();
 await consumer.subscribe({ topic: 'weather-data', fromBeginning: true });

 await consumer.run({
  eachMessage: async ({ message }) => {
   await processMessage(message);
  },
 });
}

process.on('SIGINT', async () => {
 console.log('Shutting down gracefully...');
 await consumer.disconnect();
 process.exit(0);
});

startConsumer().catch(console.error);

app.listen(process.env.PORTB, () => {
 console.log('Weather Consumer running on port', process.env.PORTB);
});
