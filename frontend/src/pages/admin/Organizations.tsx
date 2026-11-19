import React from 'react';
import { CrudPage } from '../../components/CrudPage';

export function Organizations() {
  return (
    <CrudPage
      title="Organization"
      endpoint="/organizations"
      columns={[
        { key: 'code', label: 'Code', sortable: true },
        { key: 'name', label: 'Name', sortable: true },
        { key: 'contact', label: 'Contact' },
      ]}
      fields={[
        { name: 'code', label: 'Code', required: true, createOnly: true },
        { name: 'name', label: 'Name', required: true },
        { name: 'address', label: 'Address' },
        { name: 'contact', label: 'Contact' },
      ]}
    />
  );
}
