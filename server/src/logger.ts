/**
 * Structured logging for Cloud Run (JSON format for Cloud Logging)
 */

import winston from "winston";
import { config } from "./config";

const isProduction = config.nodeEnv === "production";

export const logger = winston.createLogger({
  level: isProduction ? "info" : "debug",
  format: isProduction
    ? winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      )
    : winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      ),
  defaultMeta: { service: "nycking-server" },
  transports: [new winston.transports.Console()],
});
