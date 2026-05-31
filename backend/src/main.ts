import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  app.enableCors({
    origin: (process.env.CORS_ORIGINS || 'http://127.0.0.1:4200,http://localhost:4200')
      .split(',')
      .map((origin) => origin.trim()),
    credentials: true,
  });

  if ((process.env.SWAGGER_ENABLED || 'true').toLowerCase() === 'true') {
    const config = new DocumentBuilder()
      .setTitle('PlantillaInicio API')
      .setDescription('Base reusable con auth, usuarios, roles y permisos')
      .setVersion('1.0.0')
      .addBearerAuth()
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('docs', app, document);
  }

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
