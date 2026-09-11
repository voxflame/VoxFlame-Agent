"""Keep both dependency-build paths on the same complete application payload."""
from pathlib import Path
import unittest


class ImagePackagingTests(unittest.TestCase):
    def test_every_image_copies_all_runtime_modules_and_imports_app(self) -> None:
        root = Path(__file__).resolve().parents[1]
        for name in ("Dockerfile", "Dockerfile.localvenv"):
            with self.subTest(dockerfile=name):
                source = (root / name).read_text()
                self.assertIn("COPY *.py /app/", source)
                self.assertIn('python -c "import app"', source)
                self.assertIn("PYTHON_DOTENV_DISABLED=1", source)
                self.assertNotIn("COPY . /app", source)


if __name__ == "__main__":
    unittest.main()
