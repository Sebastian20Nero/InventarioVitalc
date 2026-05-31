import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePerm } from '../common/decorators/require-perm.decorator';
import { AuthUser } from '../common/interfaces/auth-user.interface';
import { AccionEmpalmeDto } from './dto/accion-empalme.dto';
import { ConfiguracionDsnubeDto } from './dto/configuracion-dsnube.dto';
import { ImportarDsnubeDto } from './dto/importar-dsnube.dto';
import { EmpalmeService } from './empalme.service';

type AuthenticatedRequest = Request & { user: AuthUser };

@ApiTags('Empalme')
@ApiBearerAuth()
@Controller('empalme')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class EmpalmeController {
  constructor(private readonly empalmeService: EmpalmeService) {}

  @Get('movimientos')
  @RequirePerm('EMPALME_REVISAR')
  listarMovimientos() {
    return this.empalmeService.listarMovimientos();
  }

  @Post('movimientos/:id/revisar')
  @RequirePerm('EMPALME_REVISAR')
  revisar(@Param('id') id: string, @Body() dto: AccionEmpalmeDto, @Req() request: AuthenticatedRequest) {
    return this.empalmeService.revisar(id, dto, request.user.userId);
  }

  @Post('movimientos/:id/observar')
  @RequirePerm('EMPALME_OBSERVAR')
  observar(@Param('id') id: string, @Body() dto: AccionEmpalmeDto, @Req() request: AuthenticatedRequest) {
    return this.empalmeService.observar(id, dto, request.user.userId);
  }

  @Post('movimientos/:id/marcar-listo')
  @RequirePerm('EMPALME_MARCAR_LISTO')
  marcarListo(
    @Param('id') id: string,
    @Body() dto: AccionEmpalmeDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.empalmeService.marcarListo(id, dto, request.user.userId);
  }

  @Post('movimientos/:id/marcar-cargado')
  @RequirePerm('EMPALME_MARCAR_CARGADO')
  marcarCargado(
    @Param('id') id: string,
    @Body() dto: AccionEmpalmeDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.empalmeService.marcarCargado(id, dto, request.user.userId);
  }

  @Get('reporte')
  @RequirePerm('EMPALME_REVISAR')
  obtenerReporte() {
    return this.empalmeService.obtenerReporte();
  }

  @Get('reporte/exportar')
  @RequirePerm('EMPALME_REVISAR')
  async exportarReporte(@Query('formato') formato: string, @Res() response: Response) {
    const file = await this.empalmeService.exportarReporte(formato);
    response.setHeader('Content-Type', file.contentType);
    response.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    response.send(file.buffer);
  }

  @Get('importar/plantilla')
  @RequirePerm('EMPALME_REVISAR')
  async descargarPlantilla(@Res() response: Response) {
    const file = await this.empalmeService.descargarPlantillaImportacion();
    response.setHeader('Content-Type', file.contentType);
    response.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    response.send(file.buffer);
  }

  @Post('importar')
  @RequirePerm('EMPALME_MARCAR_CARGADO')
  @UseInterceptors(FileInterceptor('file'))
  importarExcel(@UploadedFile() file: Express.Multer.File, @Req() request: AuthenticatedRequest) {
    return this.empalmeService.importarDesdeExcel(file, request.user.userId);
  }

  @Post('importar/consecutivos')
  @RequirePerm('EMPALME_MARCAR_CARGADO')
  importarConsecutivos(@Body() dto: ImportarDsnubeDto, @Req() request: AuthenticatedRequest) {
    return this.empalmeService.marcarCargadosPorConsecutivo(dto, request.user.userId);
  }

  @Get('configuracion-dsnube')
  @RequirePerm('EMPALME_REVISAR')
  obtenerConfiguracion() {
    return this.empalmeService.obtenerConfiguracion();
  }

  @Post('configuracion-dsnube')
  @RequirePerm('EMPALME_MARCAR_CARGADO')
  guardarConfiguracion(@Body() dto: ConfiguracionDsnubeDto) {
    return this.empalmeService.guardarConfiguracion(dto);
  }
}
