'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useParams, useRouter } from 'next/navigation';
import { ProductForm } from '@/components/erp/products/ProductForm';

export default function EditProductPage() {
  const { id } = useParams();
  const router  = useRouter();

  const { data: product, isLoading } = useQuery({
    queryKey: ['product-erp', id],
    queryFn:  () => api.get(`/products/${id}`).then(r => r.data.data),
  });

  if (isLoading) return (
    <div className="flex items-center justify-center py-24 text-gray-400">Loading...</div>
  );
  if (!product) return (
    <div className="flex items-center justify-center py-24 text-gray-400">Product not found.</div>
  );

  return (
    <ProductForm
      product={product}
      onSaved={() => router.push('/products')}
      onCancel={() => router.push('/products')}
    />
  );
}
