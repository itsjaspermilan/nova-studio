// zlib decompression through the platform's own DecompressionStream (the studio's window has one, and so does Node), used by the readers of
// animated PNG and Aseprite files, whose pictures are zlib-compressed.

export async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new DecompressionStream("deflate");
  const writer = stream.writable.getWriter();
  void writer.write(data as unknown as BufferSource).catch(() => {});
  void writer.close().catch(() => {});
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}
