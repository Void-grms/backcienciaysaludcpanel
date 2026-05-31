import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '@shared/prisma/prisma.service';

// Genera codigos `ORD-YYYY-NNNNNN` de forma atomica.
//
// Estrategia MySQL: INSERT ... ON DUPLICATE KEY UPDATE incrementa last_number
// atomicamente bajo InnoDB (bloqueo de fila implicito). Luego un SELECT
// inmediato devuelve el valor actual. Funciona dentro de una transaccion
// externa (cuando se provee `tx`) o directamente.
@Injectable()
export class OrderCodeService {
  constructor(private readonly prisma: PrismaService) {}

  async nextCode(tx?: Prisma.TransactionClient): Promise<string> {
    const client = tx ?? this.prisma;
    const year = new Date().getFullYear();

    // MySQL UPSERT atomico: crea la fila del ano si no existe o incrementa.
    await client.$executeRaw(
      Prisma.sql`INSERT INTO order_sequences (year, last_number)
        VALUES (${year}, 1)
        ON DUPLICATE KEY UPDATE last_number = last_number + 1`,
    );

    const rows = await client.$queryRaw<Array<{ last_number: bigint }>>(
      Prisma.sql`SELECT last_number FROM order_sequences WHERE year = ${year}`,
    );

    const next = Number(rows[0]?.last_number ?? 0);
    if (!next) {
      throw new Error('No se pudo generar el codigo de orden');
    }
    return `ORD-${year}-${String(next).padStart(6, '0')}`;
  }
}
