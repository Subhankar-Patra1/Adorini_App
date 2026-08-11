import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { BaseEntity } from './base.entity';
import type { Product } from './product.entity';
import type { User } from './user.entity';
import { SizeEnquiryStatus } from '../../common/enums/domain.enums';

/**
 * A request for a size outside the stocked 40–48 band — the fallback path when
 * the dynamic size chart tells a buyer nothing fits.
 *
 * Doubles as demand data: a cluster of size-50 enquiries on one category is the
 * evidence for extending the size band.
 */
@Index('idx_size_enquiries_status', ['status', 'createdAt'])
@Entity('size_enquiries')
export class SizeEnquiry extends BaseEntity {
  @Index()
  @ManyToOne('Product', 'sizeEnquiries', {
    onDelete: 'CASCADE',
    nullable: false,
  })
  @JoinColumn()
  product: Product;

  @Column({ type: 'uuid' })
  productId: string;

  /** Null when an unauthenticated visitor enquires from the PDP. */
  @ManyToOne('User', { onDelete: 'SET NULL', nullable: true })
  @JoinColumn()
  user: User | null;

  @Column({ type: 'uuid', nullable: true })
  userId: string | null;

  /** Free text, not the nominal-size smallint — the whole point is it is out of range. */
  @Column({ type: 'varchar', length: 32 })
  requestedSize: string;

  @Column({ type: 'varchar', length: 15 })
  contactPhone: string;

  @Column({ type: 'text', nullable: true })
  message: string | null;

  @Column({
    type: 'enum',
    enum: SizeEnquiryStatus,
    enumName: 'size_enquiry_status',
    default: SizeEnquiryStatus.OPEN,
  })
  status: SizeEnquiryStatus;

  @Column({ type: 'text', nullable: true })
  adminResponse: string | null;
}
