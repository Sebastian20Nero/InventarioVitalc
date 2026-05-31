import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { UsersService } from '../users/users.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) {}

  async login(correo: string, password: string) {
    const normalizedEmail = correo.trim().toLowerCase();
    const user = await this.usersService.findUsuarioByCorreo(normalizedEmail);

    if (!user || !user.activo) {
      throw new UnauthorizedException('Credenciales invalidas');
    }

    const validPassword = await bcrypt.compare(password, user.passwordHash);
    if (!validPassword) {
      throw new UnauthorizedException('Credenciales invalidas');
    }

    const serializedUser = this.usersService.serializeUser(user);
    const token = await this.jwtService.signAsync({
      sub: user.idUsuario.toString(),
      correo: user.persona.correo,
    });

    return {
      token,
      user: serializedUser,
    };
  }
}
