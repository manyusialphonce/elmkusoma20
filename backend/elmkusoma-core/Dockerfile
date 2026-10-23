
FROM eclipse-temurin:21-jdk AS build

RUN apt-get update && apt-get install -y --no-install-recommends bash \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY pom.xml .
COPY .mvn .mvn
COPY mvnw .

RUN chmod +x mvnw && bash ./mvnw dependency:go-offline -B

COPY src ./src

RUN bash ./mvnw clean package -DskipTests -B

FROM eclipse-temurin:21-jre

RUN groupadd --system appgroup && useradd --system --gid appgroup --create-home appuser

WORKDIR /app

COPY --from=build /app/target/*.jar app.jar

RUN chown -R appuser:appgroup /app

USER appuser

EXPOSE 8080

ENTRYPOINT ["java", "-jar", "app.jar"]
