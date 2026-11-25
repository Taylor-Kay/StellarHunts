import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { numericTransformer } from './economy-snapshot.entity';

/** A single reward payout, aggregated per day to derive issuance rates. */
@Entity('reward_distributions')
export class RewardDistribution {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Reward amount in whole token units. */
  @Column({
    type: 'decimal',
    precision: 30,
    scale: 0,
    transformer: numericTransformer,
  })
  amount: number;

  /** Earn category, e.g. `daily_check_in`, `puzzle`, `quiz`. */
  @Column()
  category: string;

  /** Optional account that received the reward. */
  @Column({ type: 'varchar', nullable: true })
  recipient: string | null;

  /** UTC calendar day (YYYY-MM-DD) the reward was issued on. */
  @Index()
  @Column({ type: 'date' })
  distributionDate: string;

  @CreateDateColumn()
  createdAt: Date;
}
