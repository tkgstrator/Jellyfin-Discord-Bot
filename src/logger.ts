import { consola, createConsola } from 'consola';

export const logger = createConsola({
  level: process.env.LOG_LEVEL ? parseInt(process.env.LOG_LEVEL) : 3,
  formatOptions: {
    date: true,
    colors: true,
  },
});

export default logger;
