"""Lee un PDF de DROPI con el parser verificado y escribe JSON por la salida estándar.

No modifica parser_dropi.py. Lo importa desde backend/lector_dropi, copia fiel del paquete.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lector_dropi"))

from parser_dropi import leer_pdf  # noqa: E402


def main() -> int:
    if len(sys.argv) != 2:
        print("Uso: leer_dropi.py ruta.pdf", file=sys.stderr)
        return 2
    manifiesto = leer_pdf(sys.argv[1])
    fecha = manifiesto.fecha_manifiesto.isoformat() if manifiesto.fecha_manifiesto else ""
    salida = {
        "transportadora": manifiesto.transportadora,
        "fecha": fecha,
        "nombreArchivo": manifiesto.archivo,
        "huella": manifiesto.hash_archivo,
        "paginas": manifiesto.paginas,
        "avisos": manifiesto.avisos,
        "validaciones": manifiesto.validar(),
        "unidadesRotulos": manifiesto.unidades_rotulos,
        "unidadesResumen": manifiesto.unidades_resumen,
        "guias": [
            {
                "numero": guia.numero,
                "consecutivo": guia.consecutivo,
                "ciudad": guia.ciudad_destino,
                "recaudo": f"{guia.valor_recaudo:.2f}",
                "tipo": guia.tipo_logistica,
                "textoRotulo": "; ".join(f"{producto.nombre_dropi} x {producto.cantidad}" for producto in guia.productos),
            }
            for guia in manifiesto.guias
        ],
        "resumen": [
            {
                "sku": producto.sku_dropi,
                "idDropi": producto.id_dropi,
                "nombre": producto.nombre_dropi,
                "cantidad": producto.cantidad,
            }
            for producto in manifiesto.resumen
        ],
    }
    json.dump(salida, sys.stdout, ensure_ascii=False)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
