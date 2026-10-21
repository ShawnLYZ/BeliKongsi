export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const x = new URL(request.url).searchParams.get('x');
  return Response.json({ id, x });
}
