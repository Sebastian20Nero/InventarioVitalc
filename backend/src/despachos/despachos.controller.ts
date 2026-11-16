import { Body, Controller, Get, Param, Post, Query, Req, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePerm } from '../common/decorators/require-perm.decorator';
import { AuthUser } from '../common/interfaces/auth-user.interface';
import { AsignarDto } from './dto/asignar.dto';
import { CerrarCorteDto, EscanearDto, PrefijoDto, RepresarDto, ReprogramarDto } from './dto/cierre.dto';
import { EquivalenciaDto } from './dto/equivalencia.dto';
import { EtapaDto } from './dto/etapa.dto';
import { GuardarCorteDto } from './dto/guardar-corte.dto';
import { DespachosService } from './despachos.service';

type AuthenticatedRequest = Request & { user: AuthUser };

@ApiTags('Despachos')
@ApiBearerAuth()
@Controller('despachos')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class DespachosController {
  constructor(private readonly despachos: DespachosService) {}

  @Post('revisar')
  @RequirePerm('DESPACHO_CARGAR')
  @UseInterceptors(FileInterceptor('archivo', { limits: { fileSize: 40 * 1024 * 1024 } }))
  revisar(@UploadedFile() archivo: Express.Multer.File) {
    return this.despachos.revisar(archivo);
  }

  @Post('equivalencias')
  @RequirePerm('DESPACHO_CARGAR')
  asociar(@Body() dto: EquivalenciaDto, @Req() request: AuthenticatedRequest) {
    return this.despachos.asociar(dto, request.user.userId);
  }

  @Post('cortes')
  @RequirePerm('DESPACHO_CARGAR')
  guardar(@Body() dto: GuardarCorteDto, @Req() request: AuthenticatedRequest) {
    return this.despachos.guardar(dto, request.user.userId);
  }

  @Get('tablero')
  @RequirePerm('DESPACHO_CONSULTAR')
  tablero(@Query('fecha') fecha: string) {
    return this.despachos.tablero(fecha);
  }

  @Get('usuarios')
  @RequirePerm('DESPACHO_CARGAR')
  usuarios() {
    return this.despachos.usuarios();
  }

  @Post('cortes/:id/asignar')
  @RequirePerm('DESPACHO_CARGAR')
  asignar(@Param('id') id: string, @Body() dto: AsignarDto, @Req() request: AuthenticatedRequest) {
    return this.despachos.asignar(id, dto, request.user.userId);
  }

  @Get('cortes/:id/alistamiento')
  @RequirePerm('DESPACHO_CONSULTAR')
  alistamiento(@Param('id') id: string) {
    return this.despachos.alistamiento(id);
  }

  @Post('alistamiento/:id/etapa')
  @RequirePerm('DESPACHO_ALISTAR')
  marcar(@Param('id') id: string, @Body() dto: EtapaDto, @Req() request: AuthenticatedRequest) {
    return this.despachos.marcar(id, dto, request.user.userId);
  }

  @Get('cortes/:id/guias')
  @RequirePerm('DESPACHO_CONSULTAR')
  guias(@Param('id') id: string) {
    return this.despachos.guias(id);
  }

  @Post('cortes/:id/escanear')
  @RequirePerm('DESPACHO_DESPACHAR')
  escanear(@Param('id') id: string, @Body() dto: EscanearDto, @Req() request: AuthenticatedRequest) {
    return this.despachos.escanear(id, dto.codigo, request.user.userId);
  }

  @Post('guias/:id/represar')
  @RequirePerm('DESPACHO_DESPACHAR')
  represar(@Param('id') id: string, @Body() dto: RepresarDto, @Req() request: AuthenticatedRequest) {
    return this.despachos.represar(id, dto.motivo, request.user.userId);
  }

  @Post('guias/:id/reprogramar')
  @RequirePerm('DESPACHO_DESPACHAR')
  reprogramar(@Param('id') id: string, @Body() dto: ReprogramarDto, @Req() request: AuthenticatedRequest) {
    return this.despachos.reprogramar(id, dto.corteDestinoId, request.user.userId);
  }

  @Post('cortes/:id/cerrar')
  @RequirePerm('DESPACHO_DESPACHAR')
  cerrar(@Param('id') id: string, @Body() dto: CerrarCorteDto, @Req() request: AuthenticatedRequest) {
    return this.despachos.cerrar(id, dto, request.user.userId);
  }

  @Get('transportadoras')
  @RequirePerm('DESPACHO_DESPACHAR')
  transportadoras() {
    return this.despachos.transportadoras();
  }

  @Post('prefijos')
  @RequirePerm('DESPACHO_DESPACHAR')
  prefijo(@Body() dto: PrefijoDto, @Req() request: AuthenticatedRequest) {
    return this.despachos.definirPrefijo(dto, request.user.userId);
  }

  @Get('cortes-abiertos')
  @RequirePerm('DESPACHO_DESPACHAR')
  abiertos(@Query('excepto') excepto: string) {
    return this.despachos.cortesAbiertos(excepto || '0');
  }

  @Get('excel')
  @RequirePerm('DESPACHO_CONSULTAR')
  async excel(@Query('fecha') fecha: string, @Res() response: Response) {
    const archivo = await this.despachos.excel(fecha);
    response.setHeader('Content-Type', archivo.contentType);
    response.setHeader('Content-Disposition', `attachment; filename="${archivo.filename}"`);
    response.send(archivo.buffer);
  }
}
