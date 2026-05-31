import { Body, Controller, Get, Param, Patch, Post, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePerm } from '../common/decorators/require-perm.decorator';
import { AuthUser } from '../common/interfaces/auth-user.interface';
import { CreateProductoDto } from './dto/create-producto.dto';
import { UpdateProductoEstadoDto } from './dto/update-producto-estado.dto';
import { UpdateProductoDto } from './dto/update-producto.dto';
import { ProductosService } from './productos.service';

type AuthenticatedRequest = Request & { user: AuthUser };

@ApiTags('Productos')
@ApiBearerAuth()
@Controller('productos')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ProductosController {
  constructor(private readonly productosService: ProductosService) {}

  @Get()
  @RequirePerm('PRODUCTO_CONSULTAR')
  listar() {
    return this.productosService.listar();
  }

  @Get(':id')
  @RequirePerm('PRODUCTO_CONSULTAR')
  obtenerPorId(@Param('id') id: string) {
    return this.productosService.obtenerPorId(id);
  }

  @Post()
  @RequirePerm('PRODUCTO_CREAR')
  crear(@Body() dto: CreateProductoDto, @Req() request: AuthenticatedRequest) {
    return this.productosService.crear(dto, request.user.userId);
  }

  @Put(':id')
  @RequirePerm('PRODUCTO_EDITAR')
  actualizar(@Param('id') id: string, @Body() dto: UpdateProductoDto) {
    return this.productosService.actualizar(id, dto);
  }

  @Patch(':id/estado')
  @RequirePerm('PRODUCTO_EDITAR')
  actualizarEstado(@Param('id') id: string, @Body() dto: UpdateProductoEstadoDto) {
    return this.productosService.actualizarEstado(id, dto);
  }
}
