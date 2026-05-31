import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PermissionsGuard } from '../auth/permissions.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequirePerm } from '../common/decorators/require-perm.decorator';
import { CatalogosService } from './catalogos.service';
import { CreateBodegaDto } from './dto/create-bodega.dto';
import { CreateCategoriaDto } from './dto/create-categoria.dto';
import { CreateUnidadDto } from './dto/create-unidad.dto';
import { UpdateBodegaDto } from './dto/update-bodega.dto';
import { UpdateCategoriaDto } from './dto/update-categoria.dto';
import { UpdateUnidadDto } from './dto/update-unidad.dto';

@ApiTags('Catalogos')
@ApiBearerAuth()
@Controller('catalogos')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CatalogosController {
  constructor(private readonly catalogosService: CatalogosService) {}

  @Get('categorias')
  @RequirePerm('PRODUCTO_CONSULTAR')
  listarCategorias() {
    return this.catalogosService.listarCategorias();
  }

  @Post('categorias')
  @RequirePerm('PRODUCTO_CREAR')
  crearCategoria(@Body() dto: CreateCategoriaDto) {
    return this.catalogosService.crearCategoria(dto);
  }

  @Put('categorias/:id')
  @RequirePerm('PRODUCTO_EDITAR')
  actualizarCategoria(@Param('id') id: string, @Body() dto: UpdateCategoriaDto) {
    return this.catalogosService.actualizarCategoria(id, dto);
  }

  @Get('unidades')
  @RequirePerm('PRODUCTO_CONSULTAR')
  listarUnidades() {
    return this.catalogosService.listarUnidades();
  }

  @Post('unidades')
  @RequirePerm('PRODUCTO_CREAR')
  crearUnidad(@Body() dto: CreateUnidadDto) {
    return this.catalogosService.crearUnidad(dto);
  }

  @Put('unidades/:id')
  @RequirePerm('PRODUCTO_EDITAR')
  actualizarUnidad(@Param('id') id: string, @Body() dto: UpdateUnidadDto) {
    return this.catalogosService.actualizarUnidad(id, dto);
  }

  @Get('bodegas')
  @RequirePerm('STOCK_CONSULTAR')
  listarBodegas() {
    return this.catalogosService.listarBodegas();
  }

  @Post('bodegas')
  @RequirePerm('ADMIN_ACCESS')
  crearBodega(@Body() dto: CreateBodegaDto) {
    return this.catalogosService.crearBodega(dto);
  }

  @Put('bodegas/:id')
  @RequirePerm('ADMIN_ACCESS')
  actualizarBodega(@Param('id') id: string, @Body() dto: UpdateBodegaDto) {
    return this.catalogosService.actualizarBodega(id, dto);
  }
}
