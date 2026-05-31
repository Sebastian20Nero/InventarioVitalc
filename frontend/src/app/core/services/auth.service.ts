import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { tap } from 'rxjs';
import { environment } from '../../../environments/environment';
import { LoginResponse, UserProfile } from '../models/security.models';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly storageKey = 'plantilla_inicio_token';

  readonly token = signal<string | null>(localStorage.getItem(this.storageKey));
  readonly currentUser = signal<UserProfile | null>(null);
  readonly loadingProfile = signal(false);
  readonly isLoggedIn = computed(() => !!this.token());

  constructor() {
    if (this.token()) {
      this.fetchProfile().subscribe({
        error: () => this.logout(),
      });
    }
  }

  login(correo: string, password: string) {
    return this.http
      .post<LoginResponse>(`${environment.apiBaseUrl}/auth/login`, { correo, password })
      .pipe(
        tap((response) => {
          localStorage.setItem(this.storageKey, response.token);
          this.token.set(response.token);
          this.currentUser.set(response.user);
        }),
      );
  }

  fetchProfile() {
    this.loadingProfile.set(true);
    return this.http.get<UserProfile>(`${environment.apiBaseUrl}/auth/me`).pipe(
      tap({
        next: (user) => this.currentUser.set(user),
        complete: () => this.loadingProfile.set(false),
        error: () => this.loadingProfile.set(false),
      }),
    );
  }

  logout() {
    localStorage.removeItem(this.storageKey);
    this.token.set(null);
    this.currentUser.set(null);
    this.router.navigate(['/auth/signin']);
  }

  hasPermission(permission: string) {
    return this.currentUser()?.permisos.includes(permission) ?? false;
  }
}
