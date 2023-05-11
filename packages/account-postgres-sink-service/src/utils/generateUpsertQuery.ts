import { underscore } from 'inflection';

export const generateUpsertQuery = (
  tableName: string,
  comparisionTs: string,
  data: { [key: string]: any }[]
) => {
  // Extract column names from the first object in the array
  const columns = Object.keys(data[0]);

  columns.push('created_at');

  // Generate the VALUES part of the query
  const values = data
    .map((obj) => {
      const formattedValues = columns.map((col) => {
        if (col === 'created_at') {
          return 'current_timestamp';
        }

        const val = obj[col];
        return typeof val === 'string' ? "'" + val + "'" : val;
      });

      return `(${formattedValues.join(', ')})`;
    })
    .join(', ');

  // Generate the column names part of the query
  const columnNames = columns
    .map((col) => underscore(col))
    .join(', ');

  // Generate the UPDATE part of the query
  // Generate the UPDATE part of the query using the data values
  const updates = columns
    .filter((col) => col !== 'created_at')
    .map((col) => `${underscore(col)} = excluded.${underscore(col)}`)
    .join(', ');

  // Generate the complete query
  const query = `
    INSERT INTO ${tableName} (${columnNames})
    VALUES ${values} ON CONFLICT (address)
    DO UPDATE SET ${updates};
 `;

  return query;
};
