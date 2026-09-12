# stage 1: React build
FROM node:26-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ .
RUN npm run build

# stage 2: Go build with the UI embedded
FROM golang:1.27-alpine AS server
WORKDIR /server
COPY server/go.mod server/go.sum ./
RUN go mod download
COPY server/ .
COPY --from=web /web/dist ./web/dist
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /upload-inbox-server .

# stage 3: runtime
FROM alpine:3.24
COPY --from=server /upload-inbox-server /upload-inbox-server
USER 99:100
EXPOSE 8080
ENTRYPOINT ["/upload-inbox-server"]
