import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePerm } from '../common/decorators/require-perm.decorator';
import { AuthUser } from '../common/interfaces/auth-user.interface';
import { AnularMovimientoDto } from './dto/anular-movimiento.dto';
import { CreateMovimientoDto } from './dto/create-movimiento.dto';
import { InventarioService } from './inventario.service';

type AuthenticatedRequest = Request & { user: AuthUser };

@ApiTags('Inventario')
@ApiBearerAuth()
@Controller('inventario')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class InventarioController {
  constructor(private readonly inventarioService: InventarioService) {}

  @Get('stock/plantilla-excel')
  @RequirePerm('STOCK_CONSULTAR')
  async descargarPlantillaStock(@Res() res: Response) {
    const buffer = await this.inventarioService.generarPlantillaStock();
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="plantilla-stock.xlsx"',
      'Content-Length': buffer.length,
    });
    res.end(buffer);
  }

  @Post('stock/importar-excel')
  @RequirePerm('MOVIMIENTO_CREAR')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  importarStockExcel(
    @UploadedFile() file: Express.Multer.File,
    @Req() request: AuthenticatedRequest,
  ) {
    if (!file) {
      return { data: { procesados: 0, errores: ['No se recibió ningún archivo.'] } };
    }
    return this.inventarioService.importarStockDesdeExcel(file.buffer, request.user.userId);
  }

  @Get('stock')
  @RequirePerm('STOCK_CONSULTAR')
  listarStock() {
    return this.inventarioService.listarStock();
  }

  @Get('stock/:productoId/:bodegaId')
  @RequirePerm('STOCK_CONSULTAR')
  obtenerStock(@Param('productoId') productoId: string, @Param('bodegaId') bodegaId: string) {
    return this.inventarioService.obtenerStock(productoId, bodegaId);
  }

  @Get('movimientos')
  @RequirePerm('MOVIMIENTO_CONSULTAR')
  listarMovimientos() {
    return this.inventarioService.listarMovimientos();
  }

  @Get('movimientos/:id')
  @RequirePerm('MOVIMIENTO_CONSULTAR')
  obtenerMovimiento(@Param('id') id: string) {
    return this.inventarioService.obtenerMovimiento(id);
  }

  @Post('movimientos')
  @RequirePerm('MOVIMIENTO_CREAR')
  registrarMovimiento(@Body() dto: CreateMovimientoDto, @Req() request: AuthenticatedRequest) {
    return this.inventarioService.registrarMovimiento(dto, request.user.userId);
  }

  @Patch('movimientos/:id/anular')
  @RequirePerm('MOVIMIENTO_ANULAR')
  anularMovimiento(
    @Param('id') id: string,
    @Body() dto: AnularMovimientoDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.inventarioService.anularMovimiento(id, dto, request.user.userId);
  }
}
