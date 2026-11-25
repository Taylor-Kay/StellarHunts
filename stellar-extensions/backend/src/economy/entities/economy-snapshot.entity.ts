import { CreateDateColumn, Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * TypeORM returns `decimal` columns as strings to avoid precision loss.
 * Economy amounts are whole token units and well within the range that a JS
 * number can represent exactly, so the monitoring service converts them at
 * the boundary. Monetary transfers never go through this service.
 */
export const numericTransformer = {
  to: (value: number): number | null => value ?? null,
  from: (value: string | null): number | null =>
    value === null || value === undefined ? null : Number(value),
};

/** Point-in-time supply figures used to derive inflation over time. */
@Entity('economy_snapshots')
export class EconomySnapshot {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** UTC calendar day (YYYY-MM-DD). One snapshot per day. */
  @Index({ unique: true })
  @Column({ type: 'date' })
  snapshotDate: string;

  @Column({
    type: 'decimal',
    precision: 30,
    scale: 0,
    transformer: numericTransformer,
  })
  circulatingSupply: number;

  @Column({
    type: 'decimal',
    precision: 30,
    scale: 0,
    transformer: numericTransformer,
  })
  totalSupply: number;

  @CreateDateColumn()
  createdAt: Date;
}
