import { existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import winston from "winston";

const logsDir = dirname(process.env.LOG_FILE || "./logs/agent.log");
if (!existsSync(logsDir)) {
  mkdirSync(logsDir, { recursive: true });
}

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: winston.format.combine(
    winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
  ),
  defaultMeta: { service: "cold-calling-agent" },
  transports: [
    // Write logs to file
    new winston.transports.File({
      filename: process.env.LOG_FILE || "./logs/agent.log",
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    // Write errors to separate error file
    new winston.transports.File({
      filename: "./logs/error.log",
      level: "error",
      maxsize: 5242880,
      maxFiles: 5,
    }),
  ],
});

// If we're not in production, log to console
if (process.env.NODE_ENV !== "production") {
  logger.add(
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple(),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          const metaStr = Object.keys(meta).length
            ? JSON.stringify(meta, null, 2)
            : "";
          return `${timestamp} ${level}: ${message}${metaStr ? "\n" + metaStr : ""}`;
        })
      ),
    })
  );
}

export default logger;