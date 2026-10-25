FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
ARG MEET_COMMIT=development
ARG MEET_VERSION=0.6.0
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w -X main.buildCommit=${MEET_COMMIT} -X main.buildVersion=${MEET_VERSION}" -o /meet .
FROM alpine:3.23
RUN apk add --no-cache ca-certificates tzdata && adduser -D -u 10001 meet
COPY --from=build /meet /usr/local/bin/meet
USER meet
EXPOSE 8080
ENTRYPOINT ["meet"]
