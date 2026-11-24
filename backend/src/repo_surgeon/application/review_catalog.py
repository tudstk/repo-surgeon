"""Server-owned review choices. Browser requests cannot supply arbitrary model IDs."""

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class ReviewModel:
    id: str
    name: str
    description: str
    max_prompt_price: float
    max_completion_price: float


REVIEW_MODELS = (
    ReviewModel("deepseek/deepseek-v3.2", "DeepSeek V3.2", "Default", 0.30, 0.50),
    ReviewModel("deepseek/deepseek-v4-flash", "DeepSeek V4 Flash", "Budget", 0.12, 0.25),
)
DEFAULT_REVIEW_MODEL = REVIEW_MODELS[0].id


def review_model(model_id: str) -> ReviewModel:
    for model in REVIEW_MODELS:
        if model.id == model_id:
            return model
    raise ValueError("Choose an available review model.")
