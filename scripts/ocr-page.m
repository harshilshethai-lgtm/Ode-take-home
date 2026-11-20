#import <AppKit/AppKit.h>
#import <PDFKit/PDFKit.h>
#import <Vision/Vision.h>

// Rasterize one PDF page and print the text Vision reads.
// Usage: ocr-page <pdf> <1-based page>

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    if (argc != 3) {
      fprintf(stderr, "usage: ocr-page <pdf> <page>\n");
      return 2;
    }
    NSString *path = [NSString stringWithUTF8String:argv[1]];
    NSInteger pageNumber = [[NSString stringWithUTF8String:argv[2]] integerValue];
    PDFDocument *doc = [[PDFDocument alloc] initWithURL:[NSURL fileURLWithPath:path]];
    if (!doc || pageNumber < 1 || pageNumber > (NSInteger)doc.pageCount) {
      fprintf(stderr, "could not open %s page %ld\n", argv[1], (long)pageNumber);
      return 1;
    }
    PDFPage *page = [doc pageAtIndex:(NSUInteger)(pageNumber - 1)];
    NSRect bounds = [page boundsForBox:kPDFDisplayBoxMediaBox];
    CGFloat scale = 2;
    NSSize size = NSMakeSize(bounds.size.width * scale, bounds.size.height * scale);
    NSImage *image = [[NSImage alloc] initWithSize:size];
    [image lockFocus];
    [[NSColor whiteColor] setFill];
    NSRectFill(NSMakeRect(0, 0, size.width, size.height));
    NSAffineTransform *transform = [NSAffineTransform transform];
    [transform scaleBy:scale];
    [transform concat];
    [page drawWithBox:kPDFDisplayBoxMediaBox toContext:[[NSGraphicsContext currentContext] CGContext]];
    [image unlockFocus];

    CGImageRef cg = [image CGImageForProposedRect:NULL context:nil hints:nil];
    if (!cg) {
      fprintf(stderr, "could not rasterize page\n");
      return 1;
    }
    VNRecognizeTextRequest *request = [[VNRecognizeTextRequest alloc] init];
    request.recognitionLevel = VNRequestTextRecognitionLevelAccurate;
    request.usesLanguageCorrection = YES;
    VNImageRequestHandler *handler = [[VNImageRequestHandler alloc] initWithCGImage:cg options:@{}];
    NSError *error = nil;
    if (![handler performRequests:@[request] error:&error]) {
      fprintf(stderr, "%s\n", error.localizedDescription.UTF8String);
      return 1;
    }
    for (VNRecognizedTextObservation *obs in request.results) {
      VNRecognizedText *text = [obs topCandidates:1].firstObject;
      if (text.string) printf("%s\n", text.string.UTF8String);
    }
  }
  return 0;
}
