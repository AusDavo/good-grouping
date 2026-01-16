FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including devDependencies for Tailwind)
RUN npm install

# Copy source files needed for CSS build
COPY tailwind.config.js postcss.config.js ./
COPY src/styles/ ./src/styles/
COPY views/ ./views/

# Build CSS
RUN npm run build:css

# Production stage
FROM node:20-alpine

# Install build dependencies for better-sqlite3
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm install --production

# Copy application files
COPY src/ ./src/
COPY views/ ./views/
COPY public/ ./public/

# Copy built CSS from builder stage
COPY --from=builder /app/public/css/style.css ./public/css/style.css

# Create data directory
RUN mkdir -p /app/data

# Set environment
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "src/index.js"]
