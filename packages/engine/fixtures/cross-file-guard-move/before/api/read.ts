export async function read(user: User | undefined, id: string) {
  return db.get(id);
}
