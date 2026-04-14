'use client';

import { useRouter } from 'next/navigation';
import { ProductForm } from '@/components/erp/products/ProductForm';

export default function NewProductPage() {
  const router = useRouter();
  return (
    <ProductForm
      onSaved={(id) => router.push(`/products/${id}`)}
      onCancel={() => router.push('/products')}
    />
  );
}
