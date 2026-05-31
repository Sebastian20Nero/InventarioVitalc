import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-login-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="auth-page">
      <form class="card auth-card" (ngSubmit)="submit()">
        <div class="login-brand">
          <h1>VitalInventario</h1>
          <p class="muted">Control de inventario · DsNube</p>
        </div>
        <h2>Iniciar sesión</h2>

        <label>
          Correo
          <input [(ngModel)]="correo" name="correo" type="email" required />
        </label>

        <label>
          Contraseña
          <input [(ngModel)]="password" name="password" type="password" required />
        </label>

        <button type="submit" [disabled]="loading()">
          {{ loading() ? 'Ingresando...' : 'Ingresar' }}
        </button>

        <p class="error" *ngIf="error()">{{ error() }}</p>
      </form>
    </div>
  `,
})
export class LoginPageComponent {
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);

  correo = 'johanstian20@hotmail.com';
  password = 'rmmr';
  loading = signal(false);
  error = signal('');

  submit() {
    this.loading.set(true);
    this.error.set('');

    this.authService.login(this.correo, this.password).subscribe({
      next: () => {
        this.loading.set(false);
        this.router.navigate(['/app/dashboard']);
      },
      error: (error) => {
        this.loading.set(false);
        this.error.set(error?.error?.message ?? 'No fue posible iniciar sesión.');
      },
    });
  }
}
