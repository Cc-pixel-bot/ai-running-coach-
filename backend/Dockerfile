FROM langgenius/dify-api:1.17.1
WORKDIR /app/zhicheng
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY app ./app
EXPOSE 8000
ENTRYPOINT ["python", "-m", "uvicorn"]
CMD ["app.main:app", "--host", "0.0.0.0", "--port", "8000"]
